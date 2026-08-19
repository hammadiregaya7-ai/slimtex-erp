import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { PrismaModule } from '../common/prisma.service';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [
    PrismaModule,
    WebhookModule,
    BullModule.registerQueue({
      name: 'inventory-queue',
    }),
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
