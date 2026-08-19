import { Injectable, Logger } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { PrismaService } from '../common/prisma.service';

/**
 * Processor for Tunisian ETA (Electronic Tax Authority) submissions
 * Handles async submission of invoices to comply with Tunisian e-invoicing regulations
 */
@Processor('eta-queue')
@Injectable()
export class EtaProcessor {
  private readonly logger = new Logger(EtaProcessor.name);

  constructor(private prisma: PrismaService) {}

  @Process('submit-eta-invoice')
  async submitEtaInvoice(job: Job) {
    const { invoiceId, tenantId, type } = job.data;

    this.logger.log(`Processing ETA submission for invoice ${invoiceId}`);

    try {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId, tenantId },
        include: { items: true, tenant: true },
      });

      if (!invoice) {
        throw new Error('Invoice not found');
      }

      if (invoice.etaStatus !== 'PENDING') {
        this.logger.warn(
          `Invoice ${invoice.number} is not in PENDING status. Current: ${invoice.etaStatus}`,
        );
        return { skipped: true, reason: 'Invalid status' };
      }

      // Prepare ETA API payload according to Tunisian e-invoicing standards
      const etaPayload = this.prepareEtaPayload(invoice);

      // In production, call actual Tunisian ETA API endpoint
      // Example: POST https://api.etax.gov.tn/v1/invoices
      const etaResponse = await this.callEtaApi(etaPayload, tenantId);

      // Update invoice with ETA response
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          etaStatus: etaResponse.success ? 'ACCEPTED' : 'REJECTED',
          etaInvoiceId: etaResponse.success ? etaResponse.etaId : null,
          etaReceiptId: etaResponse.success ? etaResponse.receiptId : null,
        },
      });

      this.logger.log(
        `ETA submission successful for invoice ${invoice.number}. ETA ID: ${etaResponse.etaId}`,
      );

      return {
        success: true,
        etaId: etaResponse.etaId,
        receiptId: etaResponse.receiptId,
      };
    } catch (error: any) {
      this.logger.error(`ETA submission failed for invoice ${invoiceId}: ${error.message}`);

      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { etaStatus: 'REJECTED' },
      });

      throw error;
    }
  }

  /**
   * Prepare payload in Tunisian ETA format
   * Reference: Tunisian E-Invoicing Technical Specification v2.1
   */
  private prepareEtaPayload(invoice: any) {
    return {
      header: {
        invoiceNumber: invoice.number,
        issueDate: invoice.issueDate.toISOString().split('T')[0],
        issueTime: invoice.issueDate.toISOString().split('T')[1]?.split('.')[0] || '00:00:00',
        invoiceType: this.mapInvoiceTypeToEta(invoice.type),
        currency: 'TND',
      },
      supplier: {
        taxId: invoice.tenant.taxId,
        name: invoice.tenant.name,
        address: invoice.tenant.address,
        phone: invoice.tenant.phone,
        email: invoice.tenant.email,
      },
      customer: {
        taxId: invoice.customerTaxId || 'NON_REGISTERED',
        name: typeof invoice.customerName === 'object' 
          ? (invoice.customerName.ar || invoice.customerName.en || 'Unknown')
          : invoice.customerName || 'Unknown',
        address: null, // Optional for B2C
      },
      lineItems: invoice.items.map((item: any, index: number) => ({
        lineNumber: index + 1,
        description: typeof item.description === 'object'
          ? (item.description.ar || item.description.en || 'Item')
          : item.description || 'Item',
        quantity: parseFloat(item.quantity.toString()),
        unitPrice: parseFloat(item.unitPrice.toString()),
        taxRate: parseFloat(item.taxRate.toString()),
        taxAmount: parseFloat(
          ((item.quantity * item.unitPrice - (item.discount || 0)) * item.taxRate / 100).toFixed(3),
        ),
        lineTotal: parseFloat(item.total.toString()),
      })),
      totals: {
        subtotal: parseFloat(invoice.subtotal.toString()),
        totalTax: parseFloat(invoice.taxTotal.toString()),
        totalAmount: parseFloat(invoice.total.toString()),
      },
    };
  }

  /**
   * Map internal invoice types to ETA codes
   */
  private mapInvoiceTypeToEta(type: string): string {
    const typeMap: Record<string, string> = {
      STANDARD: '01', // Facture standard
      PROFORMA: '02', // Facture proforma
      CREDIT_NOTE: '03', // Note de crédit
      DEBIT_NOTE: '04', // Note de débit
      RECEIPT: '05', // Reçu simplifié
    };
    return typeMap[type] || '01';
  }

  /**
   * Call Tunisian ETA API
   * In production, implement actual HTTP call with proper authentication
   */
  private async callEtaApi(payload: any, tenantId: string): Promise<{
    success: boolean;
    etaId?: string;
    receiptId?: string;
    message?: string;
  }> {
    // TODO: Implement actual ETA API integration
    // Requirements:
    // 1. Obtain OAuth2 token from ETA using client credentials
    // 2. Sign payload with qualified electronic signature (QES)
    // 3. Submit to ETA endpoint
    // 4. Handle response and store receipt
    
    this.logger.log(`Mock ETA API call for tenant ${tenantId}`);
    this.logger.debug(`Payload: ${JSON.stringify(payload, null, 2)}`);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Mock successful response
    return {
      success: true,
      etaId: `ETA-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      receiptId: `RCP-${Date.now()}`,
      message: 'Invoice accepted by ETA',
    };

    // Production implementation example:
    // const token = await this.getEtaToken(tenantId);
    // const response = await axios.post(
    //   'https://api.etax.gov.tn/v1/invoices',
    //   payload,
    //   {
    //     headers: {
    //       'Authorization': `Bearer ${token}`,
    //       'Content-Type': 'application/json',
    //     },
    //   }
    // );
    // return response.data;
  }

  /**
   * Get OAuth2 token from ETA for authenticated requests
   */
  private async getEtaToken(tenantId: string): Promise<string> {
    // TODO: Implement token retrieval and caching
    // Token should be cached in Redis with proper TTL
    return 'mock-eta-token';
  }
}
