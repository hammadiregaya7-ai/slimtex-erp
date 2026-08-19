import { Controller, Get, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SalesService, CreateInvoiceDto } from './sales.service';
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
    description: 'Creates an invoice with automatic stock movement and journal entries. Supports Tunisian ETA integration.'
  })
  async createInvoice(@Request() req: any, @Body() data: CreateInvoiceDto) {
    return this.salesService.createInvoice(req.tenantId, req.userId, data);
  }

  @Get('invoices')
  @ApiOperation({ summary: 'List all invoices with filters' })
  @ApiQuery({ name: 'status', required: false, enum: ['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED'] })
  @ApiQuery({ name: 'type', required: false, enum: ['STANDARD', 'PROFORMA', 'CREDIT_NOTE', 'DEBIT_NOTE', 'RECEIPT'] })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'dateFrom', required: false, type: Date })
  @ApiQuery({ name: 'dateTo', required: false, type: Date })
  async getInvoices(@Request() req: any, @Query() filters: any) {
    return this.salesService.getInvoices(req.tenantId, filters);
  }

  @Post('invoices/:id/send')
  @ApiOperation({ 
    summary: 'Send invoice to customer',
    description: 'Marks invoice as SENT and triggers WhatsApp/email notification'
  })
  async sendInvoice(@Request() req: any, @Param('id') id: string) {
    return this.salesService.sendInvoice(req.tenantId, id);
  }

  @Post('invoices/:id/payments')
  @ApiOperation({ summary: 'Record payment against invoice' })
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

  @Post('invoices/:id/eta-submit')
  @ApiOperation({ 
    summary: 'Submit invoice to Tunisian ETA',
    description: 'Submits invoice to Electronic Tax Authority for compliance'
  })
  async submitToEta(@Request() req: any, @Param('id') id: string) {
    return this.salesService.submitToEta(req.tenantId, id);
  }

  @Get('invoices/:id')
  @ApiOperation({ summary: 'Get single invoice details' })
  async getInvoice(@Request() req: any, @Param('id') id: string) {
    const invoices = await this.salesService.getInvoices(req.tenantId, { status: undefined, type: undefined });
    return invoices.find(inv => inv.id === id);
  }
}
