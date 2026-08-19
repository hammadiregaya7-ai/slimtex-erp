import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../common/prisma.service';
import * as crypto from 'crypto';

export interface WebhookEventPayload {
  eventType: string;
  tenantId: string;
  data: any;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectQueue('webhook-queue') private webhookQueue: Queue,
    private prisma: PrismaService,
  ) {}

  /**
   * Trigger a webhook event
   * This is called when an event occurs (invoice created, payment received, etc.)
   */
  async triggerEvent(payload: WebhookEventPayload): Promise<void> {
    const { eventType, tenantId, data } = payload;

    // Find active subscriptions for this event and tenant
    const subscriptions = await this.prisma.webhookSubscription.findMany({
      where: {
        tenantId,
        event: eventType as any,
        isActive: true,
      },
    });

    for (const subscription of subscriptions) {
      // Generate HMAC signature
      const signature = this.generateSignature(
        JSON.stringify(data),
        subscription.secret,
      );

      // Add to queue for async delivery
      await this.webhookQueue.add('deliver-webhook', {
        subscriptionId: subscription.id,
        eventType,
        url: subscription.url,
        payload: data,
        headers: {
          'X-Slimtex-Signature': signature,
          'X-Slimtex-Event': eventType,
          'Content-Type': 'application/json',
          ...(subscription.headers || {}),
        },
      });
    }

    this.logger.log(`Triggered ${eventType} for ${subscriptions.length} subscribers`);
  }

  /**
   * Generate HMAC-SHA256 signature for webhook verification
   */
  private generateSignature(payload: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  /**
   * Create a new webhook subscription
   */
  async createSubscription(tenantId: string, data: {
    event: string;
    url: string;
    headers?: any;
  }): Promise<any> {
    const secret = crypto.randomBytes(32).toString('hex');

    return this.prisma.webhookSubscription.create({
      data: {
        tenantId,
        event: data.event as any,
        url: data.url,
        secret,
        headers: data.headers,
      },
      select: {
        id: true,
        event: true,
        url: true,
        secret: true, // Return secret once for client to store
        createdAt: true,
      },
    });
  }

  /**
   * List all webhook subscriptions for a tenant
   */
  async listSubscriptions(tenantId: string): Promise<any[]> {
    return this.prisma.webhookSubscription.findMany({
      where: { tenantId },
      select: {
        id: true,
        event: true,
        url: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

  /**
   * Delete a webhook subscription
   */
  async deleteSubscription(id: string, tenantId: string): Promise<void> {
    await this.prisma.webhookSubscription.delete({
      where: { id, tenantId },
    });
  }

  /**
   * Get available webhook events
   */
  getAvailableEvents(): string[] {
    return [
      'INVOICE_CREATED',
      'INVOICE_SENT',
      'INVOICE_PAID',
      'PAYMENT_RECEIVED',
      'STOCK_LOW',
      'ORDER_CREATED',
      'QUOTE_ACCEPTED',
      'ETA_SUBMITTED',
      'ETA_ACCEPTED',
    ];
  }
}
