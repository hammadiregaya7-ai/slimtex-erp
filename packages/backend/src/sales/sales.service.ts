import { Injectable, Logger, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../common/prisma.service';
import { WebhookService } from '../webhook/webhook.service';
import { InvoiceStatus, InvoiceType, EtaStatus } from '@prisma/client';

export interface CreateInvoiceDto {
  customerId?: string;
  customerName?: any; // Jsonb localized
  customerEmail?: string;
  customerPhone?: string;
  customerTaxId?: string;
  customerAddress?: any; // Jsonb localized
  type: InvoiceType | 'STANDARD' | 'PROFORMA' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'RECEIPT';
  issueDate?: Date;
  dueDate?: Date;
  warehouseId?: string;
  items: Array<{
    productId?: string;
    description: any; // Jsonb localized
    quantity: number;
    unitPrice: number;
    taxRate: number;
    discount?: number;
  }>;
  notes?: any; // Jsonb localized
  reference?: string; // Customer PO reference
}

export interface UpdateInvoiceDto {
  customerName?: any;
  customerEmail?: string;
  customerPhone?: string;
  customerTaxId?: string;
  customerAddress?: any;
  dueDate?: Date;
  notes?: any;
  items?: Array<{
    id?: string;
    productId?: string;
    description: any;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    discount?: number;
  }>;
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    @InjectQueue('eta-queue') private etaQueue: Queue,
    @InjectQueue('webhook-queue') private webhookQueue: Queue,
    @InjectQueue('inventory-queue') private inventoryQueue: Queue,
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

    // Validate invoice type restrictions
    if (data.type === 'RECEIPT' && (!data.customerName || !data.items.length)) {
      throw new BadRequestException('Receipt invoices require customer name and at least one item');
    }

    // Validate Tunisian tax ID format if provided
    if (data.customerTaxId && !this.isValidTunisianTaxId(data.customerTaxId)) {
      throw new BadRequestException('Invalid Tunisian Tax ID format');
    }

    // Calculate totals with precision
    let subtotal = 0;
    let taxTotal = 0;
    let discountTotal = 0;

    const itemsData = data.items.map((item) => {
      const lineSubtotal = item.quantity * item.unitPrice;
      const lineDiscount = item.discount || 0;
      const lineTaxable = lineSubtotal - lineDiscount;
      const lineTax = Math.round((lineTaxable * item.taxRate) / 100 * 1000) / 1000; // Round to 3 decimals
      const lineTotal = lineTaxable + lineTax;

      subtotal += lineSubtotal;
      discountTotal += lineDiscount;
      taxTotal += lineTax;

      return {
        productId: item.productId,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
        discount: lineDiscount,
        total: Math.round(lineTotal * 1000) / 1000,
      };
    });

    const total = Math.round((subtotal - discountTotal + taxTotal) * 1000) / 1000;

    // Generate sequential invoice number per tenant
    const invoiceCount = await this.prisma.invoice.count({
      where: { tenantId },
    });

    const year = new Date().getFullYear();
    const invoiceNumber = `INV-${year}-${String(invoiceCount + 1).padStart(6, '0')}`;

    // Get warehouse (default or specified)
    const warehouseId = data.warehouseId || await this.getDefaultWarehouseId(tenantId);

    // Create invoice with items in atomic transaction
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
          customerAddress: data.customerAddress,
          type: data.type as InvoiceType,
          issueDate: data.issueDate || new Date(),
          dueDate: data.dueDate,
          status: 'DRAFT',
          etaStatus: tenant.etaEnabled && data.type !== 'PROFORMA' ? 'PENDING' : 'NOT_REQUIRED',
          subtotal: subtotal - discountTotal,
          taxTotal,
          total,
          paidAmount: 0,
          notes: data.notes,
          reference: data.reference,
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

      // Create stock movements for sold items (only for STANDARD and RECEIPT types)
      if (data.type === 'STANDARD' || data.type === 'RECEIPT') {
        for (const item of data.items) {
          if (item.productId) {
            const product = await tx.product.findUnique({
              where: { id: item.productId, tenantId },
            });

            if (product && product.isTrackable) {
              await tx.stockMovement.create({
                data: {
                  tenantId,
                  productId: item.productId,
                  warehouseId,
                  type: 'SALE_SHIPMENT',
                  quantity: -Math.abs(Math.round(item.quantity)), // Negative for OUT
                  referenceId: inv.id,
                  referenceType: 'INVOICE',
                  performedBy: userId,
                  notes: { 
                    en: `Sale for invoice ${invoiceNumber}`, 
                    ar: `بيع فاتورة ${invoiceNumber}` 
                  },
                },
              });

              // Update stock level
              await this.updateStockLevel(tx, tenantId, item.productId, warehouseId, -Math.abs(Math.round(item.quantity)));
            }
          }
        }
      }

      // Create automatic journal entry for double-entry accounting
      await this.createInvoiceJournalEntry(tx, tenantId, inv.id, userId, {
        total: inv.total.toNumber(),
        taxTotal: inv.taxTotal.toNumber(),
        subtotal: inv.subtotal.toNumber(),
        customerId: data.customerId,
        customerName: data.customerName,
      });

      return inv;
    });

    // Trigger webhook for invoice creation
    await this.webhookService.triggerEvent({
      eventType: 'INVOICE_CREATED',
      tenantId,
      data: { 
        invoiceId: invoice.id, 
        number: invoice.number, 
        total: invoice.total.toNumber(),
        type: invoice.type,
      },
    });

    // Submit to ETA queue if enabled (not for PROFORMA)
    if (tenant.etaEnabled && data.type !== 'PROFORMA') {
      await this.etaQueue.add('submit-eta-invoice', {
        invoiceId: invoice.id,
        tenantId,
        type: 'INVOICE',
      }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      });
    }

    this.logger.log(`Created invoice ${invoice.number} for tenant ${tenantId} with total ${total} TND`);
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

    // Queue WhatsApp reminder if partially paid (use result which has updated values)
    const updatedInvoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });
    
    if (updatedInvoice && updatedInvoice.status === 'PARTIALLY_PAID') {
      await this.webhookQueue.add('send-whatsapp', {
        tenantId,
        type: 'payment_reminder',
        recipientPhone: updatedInvoice.customerPhone,
        invoiceNumber: updatedInvoice.number,
        remainingAmount: updatedInvoice.total.toNumber() - updatedInvoice.paidAmount.toNumber(),
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

  /**
   * Update an existing invoice (only in DRAFT status)
   */
  async updateInvoice(
    tenantId: string,
    userId: string,
    invoiceId: string,
    data: UpdateInvoiceDto,
  ) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId, tenantId },
      include: { items: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.status !== 'DRAFT') {
      throw new ConflictException(
        `Cannot update invoice in ${invoice.status} status. Only DRAFT invoices can be modified.`,
      );
    }

    // Recalculate totals if items are updated
    if (data.items) {
      let subtotal = 0;
      let taxTotal = 0;
      let discountTotal = 0;

      const itemsData = data.items.map((item) => {
        const lineSubtotal = item.quantity * item.unitPrice;
        const lineDiscount = item.discount || 0;
        const lineTaxable = lineSubtotal - lineDiscount;
        const lineTax = Math.round((lineTaxable * item.taxRate) / 100 * 1000) / 1000;
        const lineTotal = lineTaxable + lineTax;

        subtotal += lineSubtotal;
        discountTotal += lineDiscount;
        taxTotal += lineTax;

        return {
          ...item,
          total: Math.round(lineTotal * 1000) / 1000,
        };
      });

      const total = Math.round((subtotal - discountTotal + taxTotal) * 1000) / 1000;

      return this.prisma.$transaction(async (tx) => {
        // Delete existing items
        await tx.invoiceItem.deleteMany({
          where: { invoiceId },
        });

        // Create new items
        await tx.invoiceItem.createMany({
          data: itemsData.map((item) => ({
            invoiceId,
            tenantId,
            productId: item.productId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate,
            discount: item.discount || 0,
            total: item.total,
          })),
        });

        // Update invoice header
        return tx.invoice.update({
          where: { id: invoiceId },
          data: {
            customerName: data.customerName,
            customerEmail: data.customerEmail,
            customerPhone: data.customerPhone,
            customerTaxId: data.customerTaxId,
            customerAddress: data.customerAddress,
            dueDate: data.dueDate,
            notes: data.notes,
            subtotal: subtotal - discountTotal,
            taxTotal,
            total,
          },
        });
      });
    }

    // Update only header fields
    return this.prisma.invoice.update({
      where: { id: invoiceId, tenantId },
      data: {
        customerName: data.customerName,
        customerEmail: data.customerEmail,
        customerPhone: data.customerPhone,
        customerTaxId: data.customerTaxId,
        customerAddress: data.customerAddress,
        dueDate: data.dueDate,
        notes: data.notes,
      },
    });
  }

  /**
   * Cancel an invoice (reverse stock and accounting entries)
   */
  async cancelInvoice(
    tenantId: string,
    userId: string,
    invoiceId: string,
    reason?: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId, tenantId },
        include: { items: true },
      });

      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }

      if (invoice.status === 'CANCELLED') {
        throw new ConflictException('Invoice is already cancelled');
      }

      if (invoice.status === 'PAID') {
        throw new ConflictException(
          'Cannot cancel a paid invoice. Please create a credit note instead.',
        );
      }

      // Reverse stock movements for STANDARD/RECEIPT invoices
      if (invoice.type === 'STANDARD' || invoice.type === 'RECEIPT') {
        for (const item of invoice.items) {
          if (item.productId) {
            const product = await tx.product.findUnique({
              where: { id: item.productId, tenantId },
            });

            if (product && product.isTrackable) {
              // Create reverse stock movement
              await tx.stockMovement.create({
                data: {
                  tenantId,
                  productId: item.productId,
                  warehouseId: (await this.getDefaultWarehouseId(tenantId)),
                  type: 'RETURN_IN',
                  quantity: Math.abs(Math.round(item.quantity.toNumber())), // Positive for IN
                  referenceId: invoice.id,
                  referenceType: 'INVOICE_CANCELLATION',
                  performedBy: userId,
                  notes: {
                    en: `Reverse stock for cancelled invoice ${invoice.number}. Reason: ${reason || 'Not specified'}`,
                    ar: `عكس المخزون للفاتورة الملغاة ${invoice.number}. السبب: ${reason || 'غير محدد'}`,
                  },
                },
              });

              // Update stock level
              await this.updateStockLevel(
                tx,
                tenantId,
                item.productId,
                (await this.getDefaultWarehouseId(tenantId)),
                Math.abs(Math.round(item.quantity.toNumber())),
              );
            }
          }
        }
      }

      // Update invoice status
      return tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: 'CANCELLED',
          etaStatus: invoice.etaStatus === 'ACCEPTED' ? 'CANCELLED' : invoice.etaStatus,
        },
      });
    });

    // Trigger webhook
    await this.webhookService.triggerEvent({
      eventType: 'INVOICE_CANCELLED',
      tenantId,
      data: { invoiceId, number: result.number, reason },
    });

    return result;
  }

  /**
   * Get single invoice with full details
   */
  async getInvoice(tenantId: string, invoiceId: string) {
    return this.prisma.invoice.findUnique({
      where: { id: invoiceId, tenantId },
      include: {
        items: {
          include: {
            product: {
              select: {
                sku: true,
                name: true,
                barcode: true,
              },
            },
          },
        },
        payments: {
          orderBy: { paymentDate: 'desc' },
        },
      },
    });
  }

  /**
   * Get invoice statistics for dashboard
   */
  async getInvoiceStats(tenantId: string, period?: { from: Date; to: Date }) {
    const now = new Date();
    const fromDate = period?.from || new Date(now.getFullYear(), now.getMonth(), 1);
    const toDate = period?.to || now;

    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        issueDate: { gte: fromDate, lte: toDate },
        status: { not: 'CANCELLED' },
      },
      select: {
        status: true,
        total: true,
        paidAmount: true,
        type: true,
      },
    });

    const stats = {
      totalInvoices: invoices.length,
      totalRevenue: invoices.reduce((sum, inv) => sum + inv.total.toNumber(), 0),
      totalPaid: invoices.reduce((sum, inv) => sum + inv.paidAmount.toNumber(), 0),
      byStatus: {} as Record<string, number>,
      byType: {} as Record<string, number>,
      outstandingAmount: 0,
    };

    invoices.forEach((inv) => {
      stats.byStatus[inv.status] = (stats.byStatus[inv.status] || 0) + 1;
      stats.byType[inv.type] = (stats.byType[inv.type] || 0) + 1;
      stats.outstandingAmount += inv.total.toNumber() - inv.paidAmount.toNumber();
    });

    return stats;
  }

  /**
   * Validate Tunisian Tax ID (Matricule Fiscale) format
   * Format: 8 digits (e.g., "12345678") or pattern like "A1234567P"
   */
  private isValidTunisianTaxId(taxId: string): boolean {
    // Simple 8-digit format or alphanumeric pattern
    const regex = /^(\d{8}|[A-Z]\d{7}[A-Z])$/i;
    return regex.test(taxId.replace(/\s/g, ''));
  }

  /**
   * Update stock level atomically
   */
  private async updateStockLevel(
    tx: any,
    tenantId: string,
    productId: string,
    warehouseId: string,
    quantityChange: number,
  ): Promise<void> {
    const stockLevel = await tx.stockLevel.upsert({
      where: {
        tenantId_productId_warehouseId: {
          tenantId,
          productId,
          warehouseId,
        },
      },
      update: {
        quantity: { increment: quantityChange },
        updatedAt: new Date(),
      },
      create: {
        tenantId,
        productId,
        warehouseId,
        quantity: quantityChange > 0 ? quantityChange : 0,
        reservedQty: 0,
      },
    });

    // Check for low stock alert
    const product = await tx.product.findUnique({
      where: { id: productId, tenantId },
    });

    if (product && stockLevel.quantity <= product.minStockLevel) {
      // Queue low stock alert
      await this.inventoryQueue.add('low-stock-alert', {
        tenantId,
        productId,
        currentQuantity: stockLevel.quantity,
        minStockLevel: product.minStockLevel,
        productName: product.name,
      });
    }
  }

  /**
   * Create automatic journal entry for invoice (double-entry accounting)
   */
  private async createInvoiceJournalEntry(
    tx: any,
    tenantId: string,
    invoiceId: string,
    userId: string,
    invoiceData: {
      total: number;
      taxTotal: number;
      subtotal: number;
      customerId?: string;
      customerName?: any;
    },
  ): Promise<void> {
    const journalNumber = `JE-INV-${Date.now()}`;
    const customerNameStr = typeof invoiceData.customerName === 'object'
      ? (invoiceData.customerName.en || invoiceData.customerName.ar || 'Customer')
      : (invoiceData.customerName || 'Customer');

    // Create journal entry header
    const journalEntry = await tx.journalEntry.create({
      data: {
        tenantId,
        date: new Date(),
        number: journalNumber,
        description: {
          en: `Invoice sale to ${customerNameStr}`,
          ar: `فاتورة بيع لـ ${customerNameStr}`,
        },
        reference: invoiceId,
        source: 'INVOICE',
        isPosted: true,
        totalDebit: invoiceData.total,
        totalCredit: invoiceData.total,
        createdBy: userId,
        postedAt: new Date(),
      },
    });

    // Get account IDs from Chart of Accounts
    const receivableAccountId = await this.getReceivableAccountId(tenantId);
    const revenueAccountId = await this.getRevenueAccountId(tenantId);
    const vatPayableAccountId = await this.getVatPayableAccountId(tenantId);

    // Debit: Accounts Receivable (full amount)
    await tx.journalEntryLine.create({
      data: {
        tenantId,
        journalEntryId: journalEntry.id,
        accountId: receivableAccountId,
        debit: invoiceData.total,
        credit: 0,
        description: {
          en: `Accounts Receivable - ${customerNameStr}`,
          ar: `ذمم مدينة - ${customerNameStr}`,
        },
      },
    });

    // Credit: Sales Revenue (subtotal)
    if (invoiceData.subtotal > 0) {
      await tx.journalEntryLine.create({
        data: {
          tenantId,
          journalEntryId: journalEntry.id,
          accountId: revenueAccountId,
          debit: 0,
          credit: invoiceData.subtotal,
          description: {
            en: 'Sales Revenue',
            ar: 'إيرادات المبيعات',
          },
        },
      });
    }

    // Credit: VAT Payable (tax amount)
    if (invoiceData.taxTotal > 0) {
      await tx.journalEntryLine.create({
        data: {
          tenantId,
          journalEntryId: journalEntry.id,
          accountId: vatPayableAccountId,
          debit: 0,
          credit: invoiceData.taxTotal,
          description: {
            en: 'VAT Payable',
            ar: 'ضريبة القيمة المضافة المستحقة',
          },
        },
      });
    }

    // Link journal entry to invoice
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { journalEntryId: journalEntry.id },
    });
  }

  private async getRevenueAccountId(tenantId: string): Promise<string> {
    const account = await this.prisma.account.findFirst({
      where: { tenantId, code: '7000' }, // Revenue account code (Tunisian COA)
    });
    return account?.id || 'default-revenue-account';
  }

  private async getVatPayableAccountId(tenantId: string): Promise<string> {
    const account = await this.prisma.account.findFirst({
      where: { tenantId, code: '4457' }, // VAT Payable account code (Tunisian COA)
    });
    return account?.id || 'default-vat-account';
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
      where: { tenantId, code: '4110' }, // Accounts Receivable code (Tunisian COA)
    });
    return account?.id || 'default-receivable-account';
  }

  /**
   * Create journal entry for payment (double-entry accounting)
   */
  private async createPaymentJournalEntry(
    tx: any,
    tenantId: string,
    paymentId: string,
    paymentData: any,
  ) {
    const journalNumber = `JE-PAY-${Date.now()}`;

    // Create journal entry header
    const journalEntry = await tx.journalEntry.create({
      data: {
        tenantId,
        date: new Date(),
        number: journalNumber,
        description: { en: `Payment received`, ar: `استلام دفعة` },
        source: 'PAYMENT',
        isPosted: true,
        totalDebit: paymentData.amount,
        totalCredit: paymentData.amount,
        createdBy: 'system',
        postedAt: new Date(),
      },
    });

    // Get account IDs
    const cashAccountId = await this.getCashAccountId(tenantId);
    const receivableAccountId = await this.getReceivableAccountId(tenantId);

    // Debit: Cash/Bank Account (based on payment method)
    await tx.journalEntryLine.create({
      data: {
        tenantId,
        journalEntryId: journalEntry.id,
        accountId: paymentData.method === 'BANK_TRANSFER' ? await this.getBankAccountId(tenantId) : cashAccountId,
        debit: paymentData.amount,
        credit: 0,
        description: {
          en: `Payment via ${paymentData.method}`,
          ar: `دفعة عبر ${paymentData.method}`,
        },
      },
    });

    // Credit: Accounts Receivable
    await tx.journalEntryLine.create({
      data: {
        tenantId,
        journalEntryId: journalEntry.id,
        accountId: receivableAccountId,
        debit: 0,
        credit: paymentData.amount,
        description: {
          en: 'Accounts Receivable',
          ar: 'ذمم مدينة',
        },
      },
    });

    // Update payment with journal entry reference
    await tx.payment.update({
      where: { id: paymentId },
      data: { journalEntryId: journalEntry.id },
    });
  }

  private async getBankAccountId(tenantId: string): Promise<string> {
    const account = await this.prisma.account.findFirst({
      where: { tenantId, code: '1200' }, // Bank account code (Tunisian COA)
    });
    return account?.id || 'default-bank-account';
  }
}
