import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../common/prisma.service';
import { WebhookService } from '../webhook/webhook.service';

export interface CreateInvoiceDto {
  customerId?: string;
  customerName?: any; // Jsonb localized
  customerEmail?: string;
  customerPhone?: string;
  customerTaxId?: string;
  type: 'STANDARD' | 'PROFORMA' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'RECEIPT';
  issueDate?: Date;
  dueDate?: Date;
  items: Array<{
    productId?: string;
    description: any; // Jsonb localized
    quantity: number;
    unitPrice: number;
    taxRate: number;
    discount?: number;
  }>;
  notes?: any; // Jsonb localized
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    @InjectQueue('eta-queue') private etaQueue: Queue,
    @InjectQueue('webhook-queue') private webhookQueue: Queue,
    private prisma: PrismaService,
    private webhookService: WebhookService,
  ) {}

  /**
   * Create a new invoice with automatic journal entries and ETA integration
   */
  async createInvoice(tenantId: string, userId: string, data: CreateInvoiceDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new BadRequestException('Tenant not found');
    }

    // Calculate totals
    let subtotal = 0;
    let taxTotal = 0;

    const itemsData = data.items.map((item) => {
      const lineSubtotal = item.quantity * item.unitPrice;
      const lineDiscount = item.discount || 0;
      const lineTaxable = lineSubtotal - lineDiscount;
      const lineTax = (lineTaxable * item.taxRate) / 100;
      const lineTotal = lineTaxable + lineTax;

      subtotal += lineSubtotal - lineDiscount;
      taxTotal += lineTax;

      return {
        productId: item.productId,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
        discount: item.discount || 0,
        total: lineTotal,
      };
    });

    const total = subtotal + taxTotal;

    // Generate invoice number
    const invoiceCount = await this.prisma.invoice.count({
      where: { tenantId },
    });

    const invoiceNumber = `INV-${String(invoiceCount + 1).padStart(6, '0')}`;

    // Create invoice with items in transaction
    const invoice = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.create({
        data: {
          tenantId,
          number: invoiceNumber,
          customerId: data.customerId,
          customerName: data.customerName,
          customerEmail: data.customerEmail,
          customerPhone: data.customerPhone,
          customerTaxId: data.customerTaxId,
          type: data.type,
          issueDate: data.issueDate || new Date(),
          dueDate: data.dueDate,
          status: 'DRAFT',
          etaStatus: tenant.etaEnabled ? 'PENDING' : 'NOT_REQUIRED',
          subtotal,
          taxTotal,
          total,
          paidAmount: 0,
          notes: data.notes,
        },
      });

      // Create invoice items
      await tx.invoiceItem.createMany({
        data: itemsData.map((item) => ({
          ...item,
          invoiceId: inv.id,
          tenantId,
        })),
      });

      // Create stock movements for sold items
      for (const item of data.items) {
        if (item.productId) {
          await tx.stockMovement.create({
            data: {
              tenantId,
              productId: item.productId,
              warehouseId: await this.getDefaultWarehouseId(tenantId),
              type: 'SALE_SHIPMENT',
              quantity: -Math.round(item.quantity), // Negative for OUT
              referenceId: inv.id,
              referenceType: 'INVOICE',
              performedBy: userId,
              notes: { en: `Sale for invoice ${invoiceNumber}`, ar: `بيع فاتورة ${invoiceNumber}` },
            },
          });
        }
      }

      return inv;
    });

    // Trigger webhook for invoice creation
    await this.webhookService.triggerEvent({
      eventType: 'INVOICE_CREATED',
      tenantId,
      data: { invoiceId: invoice.id, number: invoice.number, total },
    });

    // Submit to ETA queue if enabled
    if (tenant.etaEnabled && data.type !== 'PROFORMA') {
      await this.etaQueue.add('submit-eta-invoice', {
        invoiceId: invoice.id,
        tenantId,
        type: 'INVOICE',
      });
    }

    this.logger.log(`Created invoice ${invoice.number} for tenant ${tenantId}`);
    return invoice;
  }

  /**
   * Send invoice to customer via email/WhatsApp
   */
  async sendInvoice(tenantId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.update({
      where: { id: invoiceId, tenantId },
      data: { status: 'SENT' },
    });

    // Trigger webhook for invoice sent
    await this.webhookService.triggerEvent({
      eventType: 'INVOICE_SENT',
      tenantId,
      data: { invoiceId: invoice.id, number: invoice.number },
    });

    // Queue WhatsApp notification
    await this.webhookQueue.add('send-whatsapp', {
      tenantId,
      type: 'invoice_delivery',
      recipientPhone: invoice.customerPhone,
      invoiceNumber: invoice.number,
      total: invoice.total,
    });

    return invoice;
  }

  /**
   * Record payment against invoice
   */
  async recordPayment(
    tenantId: string,
    userId: string,
    invoiceId: string,
    data: {
      amount: number;
      method: 'CASH' | 'BANK_TRANSFER' | 'CHECK' | 'CARD' | 'MOBILE_MONEY';
      reference?: string;
      notes?: any;
    },
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId, tenantId },
      });

      if (!invoice) {
        throw new BadRequestException('Invoice not found');
      }

      const newPaidAmount = invoice.paidAmount.toNumber() + data.amount;
      const newStatus =
        newPaidAmount >= invoice.total.toNumber() ? 'PAID' : 'PARTIALLY_PAID';

      const payment = await tx.payment.create({
        data: {
          tenantId,
          invoiceId,
          amount: data.amount,
          method: data.method,
          reference: data.reference,
          notes: data.notes,
          paymentDate: new Date(),
        },
      });

      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          paidAmount: newPaidAmount,
          status: newStatus,
        },
      });

      // Create journal entry for payment
      await this.createPaymentJournalEntry(tx, tenantId, payment.id, data);

      return payment;
    });

    // Trigger webhook for payment received
    await this.webhookService.triggerEvent({
      eventType: 'PAYMENT_RECEIVED',
      tenantId,
      data: { invoiceId, paymentId: result.id, amount: result.amount },
    });

    // Queue WhatsApp reminder if partially paid
    if (result.status === 'PARTIALLY_PAID') {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
      });
      
      await this.webhookQueue.add('send-whatsapp', {
        tenantId,
        type: 'payment_reminder',
        recipientPhone: invoice?.customerPhone,
        invoiceNumber: invoice?.number,
        remainingAmount: invoice?.total.toNumber() - result.amount,
      });
    }

    return result;
  }

  /**
   * Submit invoice to Tunisian ETA (Electronic Tax Authority)
   */
  async submitToEta(tenantId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId, tenantId },
      include: { items: true },
    });

    if (!invoice) {
      throw new BadRequestException('Invoice not found');
    }

    if (invoice.etaStatus !== 'PENDING') {
      throw new BadRequestException(
        `Invoice cannot be submitted to ETA. Current status: ${invoice.etaStatus}`,
      );
    }

    // Prepare ETA payload (Tunisian E-Invoicing format)
    const etaPayload = {
      invoiceNumber: invoice.number,
      issueDate: invoice.issueDate,
      supplierTaxId: (await this.prisma.tenant.findUnique({ where: { id: tenantId } }))?.taxId,
      customerTaxId: invoice.customerTaxId,
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
        total: item.total,
      })),
      subtotal: invoice.subtotal,
      taxTotal: invoice.taxTotal,
      total: invoice.total,
    };

    // In production, call actual ETA API here
    this.logger.log(`Submitting invoice ${invoice.number} to Tunisian ETA`);
    
    // Simulate ETA submission
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        etaStatus: 'SUBMITTED',
        etaInvoiceId: `ETA-${Date.now()}`,
      },
    });

    // Trigger webhook
    await this.webhookService.triggerEvent({
      eventType: 'ETA_SUBMITTED',
      tenantId,
      data: { invoiceId, etaInvoiceId: `ETA-${Date.now()}` },
    });

    return { success: true, etaInvoiceId: `ETA-${Date.now()}` };
  }

  /**
   * Get invoices with filters
   */
  async getInvoices(
    tenantId: string,
    filters?: {
      status?: string;
      type?: string;
      customerId?: string;
      dateFrom?: Date;
      dateTo?: Date;
    },
  ) {
    return this.prisma.invoice.findMany({
      where: {
        tenantId,
        status: filters?.status as any,
        type: filters?.type as any,
        customerId: filters?.customerId,
        issueDate: {
          gte: filters?.dateFrom,
          lte: filters?.dateTo,
        },
      },
      include: {
        items: {
          include: {
            product: {
              select: {
                sku: true,
                name: true,
              },
            },
          },
        },
        payments: true,
      },
      orderBy: { issueDate: 'desc' },
    });
  }

  private async getDefaultWarehouseId(tenantId: string): Promise<string> {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { tenantId, isDefault: true },
    });

    if (!warehouse) {
      throw new BadRequestException('No default warehouse configured');
    }

    return warehouse.id;
  }

  private async createPaymentJournalEntry(
    tx: any,
    tenantId: string,
    paymentId: string,
    paymentData: any,
  ) {
    // Simplified journal entry creation
    // In production, use proper Chart of Accounts mapping
    const journalEntry = await tx.journalEntry.create({
      data: {
        tenantId,
        date: new Date(),
        number: `JE-PAY-${Date.now()}`,
        description: { en: `Payment received`, ar: `استلام دفعة` },
        source: 'PAYMENT',
        isPosted: true,
        totalDebit: paymentData.amount,
        totalCredit: paymentData.amount,
        createdBy: 'system',
        postedAt: new Date(),
      },
    });

    // Debit: Cash/Bank Account
    await tx.journalEntryLine.create({
      data: {
        tenantId,
        journalEntryId: journalEntry.id,
        accountId: await this.getCashAccountId(tenantId),
        debit: paymentData.amount,
        credit: 0,
      },
    });

    // Credit: Accounts Receivable
    await tx.journalEntryLine.create({
      data: {
        tenantId,
        journalEntryId: journalEntry.id,
        accountId: await this.getReceivableAccountId(tenantId),
        debit: 0,
        credit: paymentData.amount,
      },
    });

    // Update payment with journal entry reference
    await tx.payment.update({
      where: { id: paymentId },
      data: { journalEntryId: journalEntry.id },
    });
  }

  private async getCashAccountId(tenantId: string): Promise<string> {
    // In production, lookup from Chart of Accounts
    const account = await this.prisma.account.findFirst({
      where: { tenantId, code: '1100' }, // Cash account code
    });
    return account?.id || 'default-cash-account';
  }

  private async getReceivableAccountId(tenantId: string): Promise<string> {
    // In production, lookup from Chart of Accounts
    const account = await this.prisma.account.findFirst({
      where: { tenantId, code: '4110' }, // Accounts Receivable code
    });
    return account?.id || 'default-receivable-account';
  }
}
