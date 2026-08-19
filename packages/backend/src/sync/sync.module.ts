import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { SyncProcessor } from './sync.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'sync-queue',
    }),
  ],
  providers: [SyncService, SyncProcessor],
  controllers: [SyncController],
  exports: [SyncService],
})
export class SyncModule {}
