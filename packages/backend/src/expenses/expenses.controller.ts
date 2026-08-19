import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ExpensesService } from './services/expenses.service';
import {
  CreateExpenseDto,
  UpdateExpenseDto,
  ApproveExpenseDto,
  CreateExpenseCategoryDto,
  UpdateExpenseCategoryDto,
} from './dto/expense.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';

@Controller('expenses')
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiBearerAuth()
@ApiTags('Expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new expense' })
  @ApiResponse({ status: 201, description: 'Expense created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Category, customer, or project not found' })
  create(@Body() createExpenseDto: CreateExpenseDto, @Request() req) {
    const tenantId = req.tenant.id;
    const userId = req.user.id;
    return this.expensesService.create(tenantId, createExpenseDto, userId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all expenses with filters' })
  @ApiResponse({ status: 200, description: 'Return all expenses' })
  @ApiQuery({ name: 'categoryId', required: false, type: String })
  @ApiQuery({ name: 'paymentStatus', required: false, enum: ['PENDING', 'PAID', 'OVERDUE'] })
  @ApiQuery({ name: 'startDate', required: false, type: Date })
  @ApiQuery({ name: 'endDate', required: false, type: Date })
  findAll(@Query() query: any, @Request() req) {
    const tenantId = req.tenant.id;
    const filters: any = {};

    if (query.categoryId) filters.categoryId = query.categoryId;
    if (query.paymentStatus) filters.paymentStatus = query.paymentStatus;
    if (query.startDate) filters.startDate = new Date(query.startDate);
    if (query.endDate) filters.endDate = new Date(query.endDate);

    return this.expensesService.findAll(tenantId, filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get expense by ID' })
  @ApiResponse({ status: 200, description: 'Return expense' })
  @ApiResponse({ status: 404, description: 'Expense not found' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.expensesService.findOne(req.tenant.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update expense' })
  @ApiResponse({ status: 200, description: 'Expense updated successfully' })
  @ApiResponse({ status: 404, description: 'Expense not found' })
  update(
    @Param('id') id: string,
    @Body() updateExpenseDto: UpdateExpenseDto,
    @Request() req,
  ) {
    return this.expensesService.update(req.tenant.id, id, updateExpenseDto);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve expense' })
  @ApiResponse({ status: 200, description: 'Expense approved successfully' })
  @ApiResponse({ status: 400, description: 'Cannot approve already paid expense' })
  @ApiResponse({ status: 404, description: 'Expense not found' })
  approve(@Param('id') id: string, @Body() dto: ApproveExpenseDto, @Request() req) {
    return this.expensesService.approve(req.tenant.id, id, dto);
  }

  @Post(':id/mark-paid')
  @ApiOperation({ summary: 'Mark expense as paid' })
  @ApiResponse({ status: 200, description: 'Expense marked as paid' })
  @ApiResponse({ status: 400, description: 'Cannot pay unapproved expense or already paid' })
  @ApiResponse({ status: 404, description: 'Expense not found' })
  @ApiQuery({ name: 'paymentDate', required: false, type: String })
  markAsPaid(
    @Param('id') id: string, 
    @Request() req,
    @Query('paymentDate') paymentDate?: string,
  ) {
    return this.expensesService.markAsPaid(req.tenant.id, id, paymentDate);
  }

  @Post(':id/journal-entry')
  @ApiOperation({ summary: 'Create journal entry for expense' })
  @ApiResponse({ status: 200, description: 'Journal entry created' })
  @ApiResponse({ status: 400, description: 'Journal entry already exists or accounts not configured' })
  @ApiResponse({ status: 404, description: 'Expense not found' })
  createJournalEntry(@Param('id') id: string, @Request() req) {
    return this.expensesService.createJournalEntry(id, req.tenant.id, req.user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete expense' })
  @ApiResponse({ status: 200, description: 'Expense deleted successfully' })
  @ApiResponse({ status: 400, description: 'Cannot delete approved expense' })
  @ApiResponse({ status: 404, description: 'Expense not found' })
  remove(@Param('id') id: string, @Request() req) {
    return this.expensesService.remove(req.tenant.id, id);
  }

  @Get('reports/:year')
  @ApiOperation({ summary: 'Get expense reports by year' })
  @ApiResponse({ status: 200, description: 'Return expense report with category breakdown' })
  @ApiQuery({ name: 'month', required: false, type: Number, description: 'Filter by month (1-12)' })
  getReports(
    @Param('year') year: string, 
    @Request() req,
    @Query('month') month?: number,
  ) {
    return this.expensesService.getReports(req.tenant.id, parseInt(year, 10), month);
  }
}
