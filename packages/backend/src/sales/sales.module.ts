import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { EtaProcessor } from './eta.processor';
import { PrismaModule } from '../common/prisma.service';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [
    PrismaModule,
    WebhookModule,
    BullModule.registerQueue({
      name: 'eta-queue',
    }),
  ],
  controllers: [SalesController],
  providers: [SalesService, EtaProcessor],
  exports: [SalesService],
})
export class SalesModule {}
