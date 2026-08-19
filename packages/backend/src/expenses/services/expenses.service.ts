import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ExpenseRepository } from '../repositories/expense.repository';
import { CreateExpenseDto, UpdateExpenseDto, ApproveExpenseDto } from '../dto/expense.dto';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class ExpensesService {
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

    // If billable, verify customer exists
    if (dto.billableToCustomerId) {
      // Customer verification would go here when Customer model exists
      // For now, we just store the ID
    }

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

    return this.expenseRepository.approve(id, tenantId, dto.approvedBy);
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

  async getReports(tenantId: string, year: number) {
    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31`);

    // Get all categories
    const categories = await this.prisma.expenseCategory.findMany({
      where: { tenantId, isActive: true },
      include: {
        _count: {
          select: { expenses: true },
        },
      },
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

        return {
          category: cat,
          totalAmount: total,
          count: cat._count.expenses,
        };
      }),
    );

    // Grand total
    const grandTotal = await this.expenseRepository.getTotalByPeriod(
      tenantId,
      startDate,
      endDate,
    );

    return {
      year,
      categories: reports,
      grandTotal,
      currency: 'TND',
    };
  }

  async createJournalEntry(expenseId: string, tenantId: string, userId: string) {
    const expense = await this.expenseRepository.findOne(expenseId, tenantId);
    if (!expense) {
      throw new NotFoundException(`Expense with ID ${expenseId} not found`);
    }

    if (expense.journalEntryId) {
      throw new BadRequestException('Journal entry already exists for this expense');
    }

    // Find expense account (EXPENSE type)
    const expenseAccount = await this.prisma.account.findFirst({
      where: { tenantId, type: 'EXPENSE' },
    });

    // Find cash/bank account (ASSET type)
    const cashAccount = await this.prisma.account.findFirst({
      where: { tenantId, type: 'ASSET', code: { startsWith: '1' } },
    });

    if (!expenseAccount || !cashAccount) {
      throw new BadRequestException('Required accounts not configured');
    }

    // Create journal entry
    const journalEntry = await this.prisma.journalEntry.create({
      data: {
        tenantId,
        date: expense.date,
        number: await this.generateJournalNumber(tenantId),
        description: { en: `Expense: ${expense.vendorName || 'Unknown vendor'}` },
        reference: expense.invoiceNumber,
        source: 'MANUAL',
        isPosted: true,
        totalDebit: expense.total,
        totalCredit: expense.total,
        createdBy: userId,
        postedAt: new Date(),
        lines: {
          create: [
            {
              tenantId,
              accountId: expenseAccount.id,
              debit: expense.total,
              credit: 0,
              description: { en: 'Expense charge' },
            },
            {
              tenantId,
              accountId: cashAccount.id,
              debit: 0,
              credit: expense.total,
              description: { en: 'Cash/Bank payment' },
            },
          ],
        },
      },
    });

    // Link expense to journal entry
    return this.prisma.expense.update({
      where: { id: expenseId, tenantId },
      data: { journalEntryId: journalEntry.id },
      include: { journalEntry: true },
    });
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
