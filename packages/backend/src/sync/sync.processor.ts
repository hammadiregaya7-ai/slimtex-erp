import { Injectable, Logger } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { SyncService } from './sync.service';

@Processor('sync-queue')
@Injectable()
export class SyncProcessor {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(private syncService: SyncService) {}

  @Process('process-sync-batch')
  async handleSyncBatch(job: Job) {
    const { payload } = job.data;
    
    this.logger.log(`Processing sync batch for device: ${payload.deviceId}`);
    
    try {
      const result = await this.syncService.processSyncBatch(payload);
      
      if (result.success) {
        this.logger.log(`Sync batch completed: ${result.processedCount} processed, ${result.failedCount} failed`);
      } else {
        this.logger.warn(`Sync batch completed with conflicts: ${JSON.stringify(result.conflicts)}`);
      }
      
      return result;
    } catch (error) {
      this.logger.error(`Sync batch failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}
