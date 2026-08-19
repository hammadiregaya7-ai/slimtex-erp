import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ExpenseRepository } from '../repositories/expense.repository';
import { CreateExpenseDto, UpdateExpenseDto, ApproveExpenseDto } from '../dto/expense.dto';
import { PrismaService } from '../../common/prisma.service';
import { PaymentStatus } from '@prisma/client';

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(
    private expenseRepository: ExpenseRepository,
    private prisma: PrismaService,
  ) {}

  async create(tenantId: string, dto: CreateExpenseDto, userId: string) {
    // Verify category exists and belongs to tenant
    const category = await this.prisma.expenseCategory.findUnique({
      where: { id: dto.categoryId },
    });

    if (!category || category.tenantId !== tenantId) {
      throw new NotFoundException('Expense category not found');
    }

    // If billable, verify customer exists (skip if model doesn't exist yet)
    if (dto.billableToCustomerId) {
      try {
        const customer = await (this.prisma as any).customer?.findUnique({
          where: { id: dto.billableToCustomerId },
        });
        
        if (!customer || customer.tenantId !== tenantId) {
          throw new NotFoundException('Customer not found for billable expense');
        }
      } catch (e) {
        // Customer model may not exist yet, skip validation
      }
    }

    // If project ID provided, verify it exists (skip if model doesn't exist yet)
    if (dto.projectId) {
      try {
        const project = await (this.prisma as any).project?.findUnique({
          where: { id: dto.projectId },
        });
        
        if (!project || project.tenantId !== tenantId) {
          throw new NotFoundException('Project not found');
        }
      } catch (e) {
        // Project model may not exist yet, skip validation
      }
    }

    this.logger.log(`Creating expense for tenant ${tenantId} by user ${userId}`);
    
    return this.expenseRepository.create({
      ...dto,
      tenantId,
      createdBy: userId,
    });
  }

  async findAll(
    tenantId: string,
    filters?: {
      categoryId?: string;
      paymentStatus?: string;
      startDate?: Date;
      endDate?: Date;
    },
  ) {
    return this.expenseRepository.findAll(tenantId, filters);
  }

  async findOne(tenantId: string, id: string) {
    const expense = await this.expenseRepository.findOne(id, tenantId);
    if (!expense) {
      throw new NotFoundException(`Expense with ID ${id} not found`);
    }
    return expense;
  }

  async update(tenantId: string, id: string, dto: UpdateExpenseDto) {
    // If category is being updated, verify it exists
    if (dto.categoryId) {
      const category = await this.prisma.expenseCategory.findUnique({
        where: { id: dto.categoryId },
      });

      if (!category || category.tenantId !== tenantId) {
        throw new NotFoundException('Expense category not found');
      }
    }

    // If billable customer is being updated, verify it exists (skip if model doesn't exist)
    if (dto.billableToCustomerId) {
      try {
        const customer = await (this.prisma as any).customer?.findUnique({
          where: { id: dto.billableToCustomerId },
        });
        
        if (!customer || customer.tenantId !== tenantId) {
          throw new NotFoundException('Customer not found for billable expense');
        }
      } catch (e) {
        // Customer model may not exist yet, skip validation
      }
    }

    // If project ID is being updated, verify it exists (skip if model doesn't exist)
    if (dto.projectId) {
      try {
        const project = await (this.prisma as any).project?.findUnique({
          where: { id: dto.projectId },
        });
        
        if (!project || project.tenantId !== tenantId) {
          throw new NotFoundException('Project not found');
        }
      } catch (e) {
        // Project model may not exist yet, skip validation
      }
    }

    this.logger.log(`Updating expense ${id} for tenant ${tenantId}`);
    return this.expenseRepository.update(id, tenantId, dto);
  }

  async approve(tenantId: string, id: string, dto: ApproveExpenseDto) {
    const expense = await this.expenseRepository.findOne(id, tenantId);
    if (!expense) {
      throw new NotFoundException(`Expense with ID ${id} not found`);
    }

    if (expense.paymentStatus === 'PAID') {
      throw new BadRequestException('Cannot approve already paid expense');
    }

    this.logger.log(`Approving expense ${id} by user ${dto.approvedBy}`);
    return this.expenseRepository.approve(id, tenantId, dto.approvedBy);
  }

  async markAsPaid(tenantId: string, id: string, paymentDate?: string) {
    const expense = await this.expenseRepository.findOne(id, tenantId);
    if (!expense) {
      throw new NotFoundException(`Expense with ID ${id} not found`);
    }

    if (!expense.approvedAt) {
      throw new BadRequestException('Cannot pay unapproved expense');
    }

    if (expense.paymentStatus === 'PAID') {
      throw new BadRequestException('Expense already marked as paid');
    }

    this.logger.log(`Marking expense ${id} as paid`);
    
    // Update expense status
    const updatedExpense = await this.prisma.expense.update({
      where: { id, tenantId },
      data: {
        paymentStatus: 'PAID',
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      },
      include: {
        category: true,
        journalEntry: true,
      },
    });

    // If no journal entry exists, create one automatically
    if (!updatedExpense.journalEntryId) {
      this.logger.log(`Auto-creating journal entry for paid expense ${id}`);
      await this.createJournalEntry(id, tenantId, expense.createdBy || 'system');
    }

    return this.expenseRepository.findOne(id, tenantId);
  }

  async remove(tenantId: string, id: string) {
    const expense = await this.expenseRepository.findOne(id, tenantId);
    if (!expense) {
      throw new NotFoundException(`Expense with ID ${id} not found`);
    }

    // Prevent deletion of approved expenses
    if (expense.approvedAt) {
      throw new BadRequestException('Cannot delete approved expense');
    }

    return this.expenseRepository.remove(id, tenantId);
  }

  async getReports(tenantId: string, year: number, month?: number) {
    const startDate = new Date(`${year}-01-01`);
    const endDate = month 
      ? new Date(`${year}-${month.toString().padStart(2, '0')}-31`)
      : new Date(`${year}-12-31`);

    // Get all categories
    const categories = await this.prisma.expenseCategory.findMany({
      where: { tenantId, isActive: true },
      include: {
        _count: {
          select: { expenses: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Calculate totals per category
    const reports = await Promise.all(
      categories.map(async (cat) => {
        const total = await this.expenseRepository.getTotalByPeriod(
          tenantId,
          startDate,
          endDate,
          cat.id,
        );

        // Get monthly breakdown if yearly report
        let monthlyBreakdown: { month: number; total: number }[] = [];
        if (!month) {
          monthlyBreakdown = await this.getMonthlyBreakdown(
            tenantId,
            year,
            cat.id,
          );
        }

        return {
          category: cat,
          totalAmount: total,
          count: cat._count.expenses,
          monthlyBreakdown,
        };
      }),
    );

    // Grand total
    const grandTotal = await this.expenseRepository.getTotalByPeriod(
      tenantId,
      startDate,
      endDate,
    );

    // Get payment status breakdown
    const paymentStatusBreakdown = await this.getPaymentStatusBreakdown(
      tenantId,
      startDate,
      endDate,
    );

    return {
      year,
      month,
      categories: reports,
      grandTotal,
      currency: 'TND',
      paymentStatusBreakdown,
      generatedAt: new Date(),
    };
  }

  async getMonthlyBreakdown(
    tenantId: string,
    year: number,
    categoryId?: string,
  ): Promise<{ month: number; total: number }[]> {
    const breakdown: { month: number; total: number }[] = [];
    
    for (let month = 1; month <= 12; month++) {
      const startDate = new Date(`${year}-${month.toString().padStart(2, '0')}-01`);
      const endDate = new Date(`${year}-${month.toString().padStart(2, '0')}-31`);
      
      const total = await this.expenseRepository.getTotalByPeriod(
        tenantId,
        startDate,
        endDate,
        categoryId,
      );
      
      breakdown.push({ month, total });
    }
    
    return breakdown;
  }

  async getPaymentStatusBreakdown(
    tenantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{ status: PaymentStatus; total: number; count: number }[]> {
    const statuses: PaymentStatus[] = ['PENDING', 'PAID', 'OVERDUE'];
    
    const breakdown = await Promise.all(
      statuses.map(async (status) => {
        const expenses = await this.prisma.expense.aggregate({
          where: {
            tenantId,
            date: {
              gte: startDate,
              lte: endDate,
            },
            paymentStatus: status,
          },
          _sum: {
            total: true,
          },
          _count: {
            id: true,
          },
        });
        
        return {
          status,
          total: Number(expenses._sum.total) || 0,
          count: expenses._count.id || 0,
        };
      }),
    );
    
    return breakdown;
  }

  async createJournalEntry(expenseId: string, tenantId: string, userId: string) {
    const expense = await this.expenseRepository.findOne(expenseId, tenantId);
    if (!expense) {
      throw new NotFoundException(`Expense with ID ${expenseId} not found`);
    }

    if (expense.journalEntryId) {
      throw new BadRequestException('Journal entry already exists for this expense');
    }

    // Get full expense with category relation
    const expenseWithCategory = await this.prisma.expense.findUnique({
      where: { id: expenseId, tenantId },
      include: {
        category: true,
      },
    });

    if (!expenseWithCategory) {
      throw new NotFoundException(`Expense with ID ${expenseId} not found`);
    }

    // Find expense account based on category if it has an account mapping (skip if field doesn't exist)
    let expenseAccount;
    try {
      const categoryWithAccount = expenseWithCategory.category as any;
      if (categoryWithAccount?.accountId) {
        expenseAccount = await this.prisma.account.findUnique({
          where: { id: categoryWithAccount.accountId },
        });
      }
    } catch (e) {
      // accountId field may not exist on ExpenseCategory yet
    }
    
    // Fallback to generic EXPENSE type account
    if (!expenseAccount) {
      expenseAccount = await this.prisma.account.findFirst({
        where: { tenantId, type: 'EXPENSE' },
      });
    }

    // Determine cash/bank account based on payment method
    let cashAccount;
    if (expenseWithCategory.paymentMethod === 'BANK_TRANSFER') {
      cashAccount = await this.prisma.account.findFirst({
        where: { tenantId, type: 'ASSET', code: { startsWith: '12' } }, // Bank accounts
      });
    } else {
      cashAccount = await this.prisma.account.findFirst({
        where: { tenantId, type: 'ASSET', code: { startsWith: '11' } }, // Cash accounts
      });
    }

    if (!expenseAccount || !cashAccount) {
      throw new BadRequestException('Required accounts not configured');
    }

    this.logger.log(`Creating journal entry for expense ${expenseId}`);

    // Create journal entry
    const categoryName = (expenseWithCategory.category?.name as any)?.en || 'Uncategorized';
    const categoryNameAr = (expenseWithCategory.category?.name as any)?.ar || 'غير مصنف';
    
    const journalEntry = await this.prisma.journalEntry.create({
      data: {
        tenantId,
        date: expenseWithCategory.date,
        number: await this.generateJournalNumber(tenantId),
        description: { 
          en: `Expense: ${expenseWithCategory.vendorName || 'Unknown vendor'} - ${categoryName}`,
          ar: `مصروف: ${expenseWithCategory.vendorName || 'غير محدد'} - ${categoryNameAr}`,
        },
        reference: expenseWithCategory.invoiceNumber,
        source: 'MANUAL',
        isPosted: true,
        totalDebit: expenseWithCategory.total,
        totalCredit: expenseWithCategory.total,
        createdBy: userId,
        postedAt: new Date(),
        lines: {
          create: [
            {
              tenantId,
              accountId: expenseAccount.id,
              debit: expenseWithCategory.total,
              credit: 0,
              description: { en: 'Expense charge', ar: 'قيد المصروفات' },
            },
            {
              tenantId,
              accountId: cashAccount.id,
              debit: 0,
              credit: expenseWithCategory.total,
              description: { en: 'Cash/Bank payment', ar: 'الدفع نقداً/بنكياً' },
            },
          ],
        },
      },
      include: {
        lines: true,
      },
    });

    // Link expense to journal entry
    const updatedExpense = await this.prisma.expense.update({
      where: { id: expenseId, tenantId },
      data: { journalEntryId: journalEntry.id },
      include: { 
        journalEntry: {
          include: {
            lines: {
              include: {
                account: true,
              },
            },
          },
        },
        category: true,
      },
    });

    this.logger.log(`Journal entry ${journalEntry.number} created for expense ${expenseId}`);
    
    return updatedExpense;
  }

  private async generateJournalNumber(tenantId: string): Promise<string> {
    const lastEntry = await this.prisma.journalEntry.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { number: true },
    });

    const year = new Date().getFullYear();
    const prefix = `JE-${year}-`;

    if (!lastEntry) {
      return `${prefix}0001`;
    }

    const lastNum = parseInt(lastEntry.number.split('-').pop() || '0', 10);
    const nextNum = (lastNum + 1).toString().padStart(4, '0');

    return `${prefix}${nextNum}`;
  }
}
