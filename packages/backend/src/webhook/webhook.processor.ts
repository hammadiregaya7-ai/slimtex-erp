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
}
