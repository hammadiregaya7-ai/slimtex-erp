import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';
import { WebhookProcessor } from './webhook.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'webhook-queue',
    }),
  ],
  providers: [WebhookService, WebhookProcessor],
  controllers: [WebhookController],
  exports: [WebhookService],
})
export class WebhookModule {}
