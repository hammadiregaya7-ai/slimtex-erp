import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../common/prisma.service';

export interface SyncPayload {
  deviceId: string;
  userId: string;
  entityType: string;
  operations: Array<{
    action: 'CREATE' | 'UPDATE' | 'DELETE';
    entityId: string;
    data: any;
    timestamp: string;
  }>;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectQueue('sync-queue') private syncQueue: Queue,
    private prisma: PrismaService,
  ) {}

  /**
   * Receive batched sync payload from mobile app
   * Mobile app sends all offline operations when connectivity is restored
   */
  async processSyncBatch(payload: SyncPayload): Promise<{
    success: boolean;
    processedCount: number;
    failedCount: number;
    conflicts: Array<{ entityId: string; action: 'CREATE' | 'UPDATE' | 'DELETE'; error: string }>;
  }> {
    const { deviceId, userId, entityType, operations } = payload;

    // Get tenant from user first to use in logging
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tenantId: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const tenantId = user.tenantId;

    const result = {
      success: true,
      processedCount: 0,
      failedCount: 0,
      conflicts: [] as Array<{ entityId: string; action: 'CREATE' | 'UPDATE' | 'DELETE'; error: string }>,
    };

    // Sort operations by timestamp to maintain order
    operations.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    for (const operation of operations) {
      try {
        await this.processOperation(operation, userId, deviceId);
        result.processedCount++;

        // Log successful sync
        await this.prisma.syncLog.create({
          data: {
            tenantId,
            deviceId,
            userId,
            entityType,
            entityId: operation.entityId,
            action: operation.action,
            payload: operation.data,
            processed: true,
          },
        });
      } catch (error: any) {
        result.failedCount++;
        result.conflicts.push({
          entityId: operation.entityId,
          action: operation.action,
          error: error.message,
        });

        this.logger.error(`Sync failed for ${entityType}:${operation.entityId}`, error);

        // Log failed sync
        await this.prisma.syncLog.create({
          data: {
            tenantId,
            deviceId,
            userId,
            entityType,
            entityId: operation.entityId,
            action: operation.action,
            payload: operation.data,
            processed: false,
            error: error.message,
          },
        });
      }
    }

    if (result.failedCount > 0) {
      result.success = false;
    }

    return result;
  }

  /**
   * Process a single sync operation with conflict resolution
   */
  private async processOperation(
    operation: { action: string; entityId: string; data: any; timestamp: string },
    userId: string,
    deviceId: string,
  ): Promise<void> {
    const { action, entityId, data, timestamp } = operation;

    // Get tenant from user
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tenantId: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const tenantId = user.tenantId;
    const entityType = this.inferEntityType(entityId);

    switch (action) {
      case 'CREATE':
        await this.handleCreate(entityType, entityId, data, tenantId);
        break;
      case 'UPDATE':
        await this.handleUpdate(entityType, entityId, data, tenantId, timestamp);
        break;
      case 'DELETE':
        await this.handleDelete(entityType, entityId, tenantId);
        break;
    }
  }

  private inferEntityType(entityId: string): string {
    // Simple heuristic based on common ID patterns
    // In production, mobile app should explicitly send entityType
    if (entityId.startsWith('inv')) return 'Invoice';
    if (entityId.startsWith('stk')) return 'StockMovement';
    if (entityId.startsWith('prd')) return 'Product';
    return 'Unknown';
  }

  private async handleCreate(
    entityType: string,
    entityId: string,
    data: any,
    tenantId: string,
  ): Promise<void> {
    // Check if entity already exists (conflict detection)
    const existing = await this.checkEntityExists(entityType, entityId, tenantId);

    if (existing) {
      // Conflict: Entity already exists on server
      // Strategy: Server wins, or merge based on timestamp
      throw new Error(`Conflict: ${entityType} ${entityId} already exists`);
    }

    // Create the entity
    // Note: Actual implementation depends on entityType
    this.logger.log(`Creating ${entityType} ${entityId}`);
  }

  private async handleUpdate(
    entityType: string,
    entityId: string,
    data: any,
    tenantId: string,
    timestamp: string,
  ): Promise<void> {
    // Check if entity exists
    const existing = await this.checkEntityExists(entityType, entityId, tenantId);

    if (!existing) {
      throw new Error(`${entityType} ${entityId} not found`);
    }

    // Conflict resolution: Compare timestamps
    const serverTimestamp = existing.updatedAt || existing.createdAt;
    const clientTimestamp = new Date(timestamp);

    if (serverTimestamp > clientTimestamp) {
      // Server has newer changes - conflict!
      throw new Error(
        `Conflict: ${entityType} ${entityId} was modified on server after mobile sync`,
      );
    }

    // Update the entity
    this.logger.log(`Updating ${entityType} ${entityId}`);
  }

  private async handleDelete(
    entityType: string,
    entityId: string,
    tenantId: string,
  ): Promise<void> {
    // Soft delete or hard delete based on entityType
    this.logger.log(`Deleting ${entityType} ${entityId}`);
  }

  private async checkEntityExists(
    entityType: string,
    entityId: string,
    tenantId: string,
  ): Promise<any> {
    // Generic entity lookup - in production, use proper Prisma model
    try {
      const model = this.prisma[entityType as keyof typeof this.prisma];
      if (model && typeof model === 'object' && 'findUnique' in model) {
        return await (model as any).findUnique({
          where: { id: entityId, tenantId },
        });
      }
    } catch {
      // Entity type not found
    }
    return null;
  }

  /**
   * Get pending sync operations for a device
   * Used when mobile app reconnects after being offline
   */
  async getPendingSyncs(deviceId: string, since?: Date): Promise<any[]> {
    const syncLogs = await this.prisma.syncLog.findMany({
      where: {
        deviceId,
        createdAt: since ? { gte: since } : undefined,
        processed: false,
      },
      orderBy: { timestamp: 'asc' },
      take: 100, // Limit batch size
    });

    return syncLogs;
  }
}
