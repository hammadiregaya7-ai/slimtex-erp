import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WebhookService } from './webhook.service';

@ApiTags('webhooks')
@Controller('webhooks')
@ApiBearerAuth()
export class WebhookController {
  constructor(private webhookService: WebhookService) {}

  @Get('events')
  @ApiOperation({ summary: 'Get available webhook events' })
  getAvailableEvents() {
    return { events: this.webhookService.getAvailableEvents() };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new webhook subscription' })
  createSubscription(@Req() req: any, @Body() body: { event: string; url: string; headers?: any }) {
    const tenantId = req.tenantId; // From TenantGuard
    return this.webhookService.createSubscription(tenantId, body);
  }

  @Get()
  @ApiOperation({ summary: 'List all webhook subscriptions' })
  listSubscriptions(@Req() req: any) {
    const tenantId = req.tenantId;
    return this.webhookService.listSubscriptions(tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a webhook subscription' })
  deleteSubscription(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.tenantId;
    return this.webhookService.deleteSubscription(id, tenantId);
  }
}
