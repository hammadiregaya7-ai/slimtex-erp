import { Injectable, Logger } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import axios from 'axios';

@Processor('webhook-queue')
@Injectable()
export class WebhookProcessor {
  private readonly logger = new Logger(WebhookProcessor.name);

  @Process('deliver-webhook')
  async deliverWebhook(job: Job) {
    const { subscriptionId, url, payload, headers } = job.data;

    this.logger.log(`Delivering webhook to ${url}`);

    try {
      const response = await axios.post(url, payload, {
        headers,
        timeout: 5000,
        validateStatus: () => true, // Don't throw on any status
      });

      if (response.status >= 200 && response.status < 300) {
        this.logger.log(`Webhook delivered successfully: ${response.status}`);
        return { success: true, status: response.status };
      } else {
        this.logger.warn(`Webhook delivery failed: ${response.status}`);
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error: any) {
      this.logger.error(`Webhook delivery error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send WhatsApp message via Twilio or other provider
   */
  @Process('send-whatsapp')
  async sendWhatsapp(job: Job) {
    const { tenantId, type, recipientPhone, invoiceNumber, total, remainingAmount } = job.data;

    this.logger.log(`Sending WhatsApp ${type} to ${recipientPhone}`);

    let message = '';

    switch (type) {
      case 'invoice_delivery':
        message = `فاتورة جديدة / New Invoice\n\n` +
                  `رقم الفاتورة / Invoice #: ${invoiceNumber}\n` +
                  `المبلغ الإجمالي / Total: ${total} TND\n\n` +
                  `شكراً لتعاملكم معنا / Thank you for your business!`;
        break;

      case 'payment_reminder':
        message = `تذكير بالدفع / Payment Reminder\n\n` +
                  `رقم الفاتورة / Invoice #: ${invoiceNumber}\n` +
                  `المبلغ المتبقي / Remaining: ${remainingAmount} TND\n\n` +
                  `يرجى سداد المبلغ المستحق / Please settle the outstanding amount.`;
        break;

      default:
        this.logger.warn(`Unknown WhatsApp message type: ${type}`);
        return { skipped: true, reason: 'Unknown type' };
    }

    // In production, integrate with Twilio, WhatsApp Business API, or local Tunisian provider
    // Example: POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json
    this.logger.log(`Mock WhatsApp send: ${message.substring(0, 50)}...`);

    // Mock successful send
    return {
      success: true,
      messageId: `WA-${Date.now()}`,
      recipient: recipientPhone,
      type,
    };
  }
}
