import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SyncService, SyncPayload } from './sync.service';

@ApiTags('sync')
@Controller('sync')
@UseGuards() // Add TenantGuard here in production
@ApiBearerAuth()
export class SyncController {
  constructor(private syncService: SyncService) {}

  @Post('batch')
  @ApiOperation({ 
    summary: 'Submit batched offline operations from mobile app',
    description: 'Mobile app sends all operations performed while offline. Server processes them with conflict resolution.'
  })
  async submitSyncBatch(@Body() payload: SyncPayload) {
    return this.syncService.processSyncBatch(payload);
  }

  @Get('pending')
  @ApiOperation({ 
    summary: 'Get pending sync operations for a device',
    description: 'Retrieve operations that need to be synced to the mobile app'
  })
  async getPendingSyncs(
    @Query('deviceId') deviceId: string,
    @Query('since') since?: string,
  ) {
    const sinceDate = since ? new Date(since) : undefined;
    return this.syncService.getPendingSyncs(deviceId, sinceDate);
  }
}
