import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiResponse, ApiParam } from '@nestjs/swagger';
import { SalesService, CreateInvoiceDto, UpdateInvoiceDto } from './sales.service';
import { TenantGuard } from '../common/guards/tenant.guard';

@ApiTags('sales')
@Controller('sales')
@UseGuards(TenantGuard)
@ApiBearerAuth()
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post('invoices')
  @ApiOperation({ 
    summary: 'Create a new invoice',
    description: 'Creates an invoice with automatic stock movement, journal entries, and ETA integration. Supports Tunisian compliance.'
  })
  @ApiResponse({ status: 201, description: 'Invoice created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request (validation error)' })
  async createInvoice(@Request() req: any, @Body() data: CreateInvoiceDto) {
    return this.salesService.createInvoice(req.tenantId, req.userId, data);
  }

  @Get('invoices')
  @ApiOperation({ summary: 'List all invoices with filters' })
  @ApiQuery({ name: 'status', required: false, enum: ['DRAFT', 'SENT', 'PAID', 'PARTIALLY_PAID', 'OVERDUE', 'CANCELLED'] })
  @ApiQuery({ name: 'type', required: false, enum: ['STANDARD', 'PROFORMA', 'CREDIT_NOTE', 'DEBIT_NOTE', 'RECEIPT'] })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'dateFrom', required: false, type: Date })
  @ApiQuery({ name: 'dateTo', required: false, type: Date })
  async getInvoices(@Request() req: any, @Query() filters: any) {
    return this.salesService.getInvoices(req.tenantId, filters);
  }

  @Get('invoices/stats')
  @ApiOperation({ summary: 'Get invoice statistics for dashboard' })
  @ApiQuery({ name: 'from', required: false, type: Date, description: 'Start date for period (default: current month)' })
  @ApiQuery({ name: 'to', required: false, type: Date, description: 'End date for period (default: today)' })
  async getInvoiceStats(@Request() req: any, @Query() params: any) {
    const period = params.from && params.to ? {
      from: new Date(params.from),
      to: new Date(params.to),
    } : undefined;
    return this.salesService.getInvoiceStats(req.tenantId, period);
  }

  @Get('invoices/:id')
  @ApiOperation({ summary: 'Get single invoice with full details' })
  @ApiParam({ name: 'id', description: 'Invoice ID' })
  async getInvoice(@Request() req: any, @Param('id') id: string) {
    return this.salesService.getInvoice(req.tenantId, id);
  }

  @Put('invoices/:id')
  @ApiOperation({ 
    summary: 'Update an existing invoice',
    description: 'Only DRAFT invoices can be updated. Updates trigger recalculation of totals.'
  })
  @ApiParam({ name: 'id', description: 'Invoice ID' })
  async updateInvoice(
    @Request() req: any,
    @Param('id') id: string,
    @Body() data: UpdateInvoiceDto,
  ) {
    return this.salesService.updateInvoice(req.tenantId, req.userId, id, data);
  }

  @Post('invoices/:id/send')
  @ApiOperation({ 
    summary: 'Send invoice to customer',
    description: 'Marks invoice as SENT and triggers WhatsApp/email notification'
  })
  @ApiParam({ name: 'id', description: 'Invoice ID' })
  async sendInvoice(@Request() req: any, @Param('id') id: string) {
    return this.salesService.sendInvoice(req.tenantId, id);
  }

  @Post('invoices/:id/payments')
  @ApiOperation({ summary: 'Record payment against invoice' })
  @ApiParam({ name: 'id', description: 'Invoice ID' })
  async recordPayment(
    @Request() req: any,
    @Param('id') id: string,
    @Body() data: {
      amount: number;
      method: 'CASH' | 'BANK_TRANSFER' | 'CHECK' | 'CARD' | 'MOBILE_MONEY';
      reference?: string;
      notes?: any;
    },
  ) {
    return this.salesService.recordPayment(req.tenantId, req.userId, id, data);
  }

  @Post('invoices/:id/cancel')
  @ApiOperation({ 
    summary: 'Cancel an invoice',
    description: 'Reverses stock movements and updates status. Paid invoices cannot be cancelled (use credit note instead).'
  })
  @ApiParam({ name: 'id', description: 'Invoice ID' })
  @HttpCode(HttpStatus.OK)
  async cancelInvoice(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.salesService.cancelInvoice(req.tenantId, req.userId, id, body?.reason);
  }

  @Post('invoices/:id/eta-submit')
  @ApiOperation({ 
    summary: 'Submit invoice to Tunisian ETA',
    description: 'Submits invoice to Electronic Tax Authority for compliance. Only for PENDING status invoices.'
  })
  @ApiParam({ name: 'id', description: 'Invoice ID' })
  async submitToEta(@Request() req: any, @Param('id') id: string) {
    return this.salesService.submitToEta(req.tenantId, id);
  }
}
