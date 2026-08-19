import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { Expense, ExpenseCategory } from '@prisma/client';

@Injectable()
export class ExpenseRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: any): Promise<Expense> {
    return this.prisma.expense.create({
      data: {
        ...data,
        taxAmount: data.amount * (data.taxRate || 0) / 100,
        total: data.amount + (data.amount * (data.taxRate || 0) / 100),
      },
      include: {
        category: true,
        journalEntry: true,
      },
    });
  }

  async findAll(tenantId: string, filters?: {
    categoryId?: string;
    paymentStatus?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<Expense[]> {
    const where: any = { tenantId };

    if (filters?.categoryId) {
      where.categoryId = filters.categoryId;
    }

    if (filters?.paymentStatus) {
      where.paymentStatus = filters.paymentStatus;
    }

    if (filters?.startDate || filters?.endDate) {
      where.date = {};
      if (filters.startDate) {
        where.date.gte = filters.startDate;
      }
      if (filters.endDate) {
        where.date.lte = filters.endDate;
      }
    }

    return this.prisma.expense.findMany({
      where,
      include: {
        category: true,
      },
      orderBy: { date: 'desc' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<Expense | null> {
    return this.prisma.expense.findUnique({
      where: { id, tenantId },
      include: {
        category: true,
        journalEntry: true,
      },
    });
  }

  async update(id: string, tenantId: string, data: any): Promise<Expense> {
    const existing = await this.prisma.expense.findUnique({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new Error('Expense not found');
    }

    // Recalculate tax and total if amount or taxRate changed
    const amount = data.amount ?? existing.amount;
    const taxRate = data.taxRate ?? existing.taxRate;
    const taxAmount = amount * (taxRate / 100);
    const total = amount + taxAmount;

    return this.prisma.expense.update({
      where: { id, tenantId },
      data: {
        ...data,
        taxAmount,
        total,
      },
      include: {
        category: true,
        journalEntry: true,
      },
    });
  }

  async approve(id: string, tenantId: string, approvedBy: string): Promise<Expense> {
    return this.prisma.expense.update({
      where: { id, tenantId },
      data: {
        approvedBy,
        approvedAt: new Date(),
      },
      include: {
        category: true,
      },
    });
  }

  async remove(id: string, tenantId: string): Promise<Expense> {
    return this.prisma.expense.delete({
      where: { id, tenantId },
    });
  }

  async findByCategoryId(categoryId: string, tenantId: string): Promise<Expense[]> {
    return this.prisma.expense.findMany({
      where: { categoryId, tenantId },
      orderBy: { date: 'desc' },
    });
  }

  async getTotalByPeriod(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    categoryId?: string,
  ): Promise<number> {
    const expenses = await this.prisma.expense.aggregate({
      where: {
        tenantId,
        categoryId,
        date: {
          gte: startDate,
          lte: endDate,
        },
        paymentStatus: 'PAID',
      },
      _sum: {
        total: true,
      },
    });

    return Number(expenses._sum.total) || 0;
  }
}
