import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ExpenseRepository } from '../repositories/expense.repository';
import { CreateExpenseDto, UpdateExpenseDto, ApproveExpenseDto } from '../dto/expense.dto';
import { PrismaService } from '../../common/prisma.service';
import { PaymentStatus } from '@prisma/client';
import { ExpenseGLComposer } from './expense-gl-composer.service';

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(
    private expenseRepository: ExpenseRepository,
    private prisma: PrismaService,
    private glComposer: ExpenseGLComposer,
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

    // If no journal entry exists, create one automatically using GL Composer
    if (!updatedExpense.journalEntryId) {
      this.logger.log(`Auto-creating journal entry for paid expense ${id}`);
      return this.glComposer.createJournalEntry(id, tenantId, expense.createdBy || 'system');
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
}
