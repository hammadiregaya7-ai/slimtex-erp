import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

/**
 * ExpenseGLComposer - Composes General Ledger entries for Expenses
 * 
 * Inspired by ERPNext's PurchaseInvoiceGLComposer pattern
 * Separates GL composition logic from the main service for better testability
 */
@Injectable()
export class ExpenseGLComposer {
  private readonly logger = new Logger(ExpenseGLComposer.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Compose GL entries for an expense
   * Follows double-entry bookkeeping principles
   */
  async compose(expenseId: string, tenantId: string): Promise<{
    debitAccount: any;
    creditAccount: any;
    amount: number;
    description: { en: string; ar: string };
  } | null> {
    const expense = await this.prisma.expense.findUnique({
      where: { id: expenseId, tenantId },
      include: {
        category: true,
      },
    });

    if (!expense) {
      this.logger.warn(`Expense ${expenseId} not found for GL composition`);
      return null;
    }

    // Skip if already paid via cash/bank (handled separately)
    if (expense.paymentStatus === 'PAID' && expense.journalEntryId) {
      this.logger.debug(`Expense ${expenseId} already has journal entry`);
      return null;
    }

    // Determine expense account from category or fallback
    let expenseAccount = await this.getExpenseAccount(tenantId, expense.categoryId);
    
    // Determine credit account based on payment status and method
    let creditAccount = await this.getCreditAccount(tenantId, expense);

    if (!expenseAccount || !creditAccount) {
      this.logger.error(`Required accounts not configured for expense ${expenseId}`);
      throw new Error('Required accounts not configured for expense');
    }

    const categoryName = typeof expense.category?.name === 'object' 
      ? (expense.category.name as any)?.en || 'Uncategorized'
      : expense.category?.name || 'Uncategorized';
      
    const categoryNameAr = typeof expense.category?.name === 'object'
      ? (expense.category.name as any)?.ar || 'غير مصنف'
      : 'غير مصنف';

    return {
      debitAccount: {
        id: expenseAccount.id,
        code: expenseAccount.code,
        name: expenseAccount.name,
      },
      creditAccount: {
        id: creditAccount.id,
        code: creditAccount.code,
        name: creditAccount.name,
      },
      amount: Number(expense.total),
      description: {
        en: `Expense: ${expense.vendorName || 'Unknown vendor'} - ${categoryName}`,
        ar: `مصروف: ${expense.vendorName || 'غير محدد'} - ${categoryNameAr}`,
      },
    };
  }

  /**
   * Get expense account from category mapping or fallback to generic EXPENSE account
   */
  private async getExpenseAccount(tenantId: string, categoryId: string) {
    // Try to get account from category if it exists
    try {
      const category = await this.prisma.expenseCategory.findUnique({
        where: { id: categoryId },
      });

      if ((category as any)?.accountId) {
        const account = await this.prisma.account.findUnique({
          where: { id: (category as any).accountId },
        });
        if (account) return account;
      }
    } catch (e) {
      // accountId field may not exist yet
    }

    // Fallback to generic EXPENSE type account
    return this.prisma.account.findFirst({
      where: { tenantId, type: 'EXPENSE' },
      orderBy: { code: 'asc' },
    });
  }

  /**
   * Get credit account based on payment method and status
   * - PAID expenses: Credit Cash/Bank account
   * - PENDING expenses: Credit Accounts Payable (liability)
   */
  private async getCreditAccount(tenantId: string, expense: any) {
    if (expense.paymentStatus === 'PAID') {
      // Paid via cash or bank
      if (expense.paymentMethod === 'BANK_TRANSFER') {
        return this.prisma.account.findFirst({
          where: { tenantId, type: 'ASSET', code: { startsWith: '12' } }, // Bank accounts (12xxxx)
          orderBy: { code: 'asc' },
        });
      } else {
        // CASH, CHECK, etc.
        return this.prisma.account.findFirst({
          where: { tenantId, type: 'ASSET', code: { startsWith: '11' } }, // Cash accounts (11xxxx)
          orderBy: { code: 'asc' },
        });
      }
    } else {
      // Unpaid - use Accounts Payable (liability)
      return this.prisma.account.findFirst({
        where: { tenantId, type: 'LIABILITY', code: { startsWith: '22' } }, // AP accounts (22xxxx)
        orderBy: { code: 'asc' },
      });
    }
  }

  /**
   * Create complete journal entry with lines
   * Similar to ERPNext's make_gl_entries pattern
   */
  async createJournalEntry(expenseId: string, tenantId: string, userId: string) {
    const glData = await this.compose(expenseId, tenantId);
    
    if (!glData) {
      throw new Error('Cannot create journal entry: GL composition failed');
    }

    const expense = await this.prisma.expense.findUnique({
      where: { id: expenseId, tenantId },
    });

    if (!expense) {
      throw new Error('Expense not found');
    }

    // Generate journal number
    const journalNumber = await this.generateJournalNumber(tenantId);

    // Create journal entry with lines
    const journalEntry = await this.prisma.journalEntry.create({
      data: {
        tenantId,
        date: expense.date,
        number: journalNumber,
        description: glData.description,
        reference: expense.invoiceNumber,
        source: 'MANUAL',
        isPosted: true,
        totalDebit: glData.amount,
        totalCredit: glData.amount,
        createdBy: userId,
        postedAt: new Date(),
        lines: {
          create: [
            {
              tenantId,
              accountId: glData.debitAccount.id,
              debit: glData.amount,
              credit: 0,
              description: { 
                en: 'Expense charge', 
                ar: 'قيد المصروفات' 
              },
            },
            {
              tenantId,
              accountId: glData.creditAccount.id,
              debit: 0,
              credit: glData.amount,
              description: { 
                en: `${glData.creditAccount.type} payment`, 
                ar: 'الدفع نقداً/بنكياً' 
              },
            },
          ],
        },
      },
      include: {
        lines: {
          include: {
            account: true,
          },
        },
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

    this.logger.log(`Journal entry ${journalNumber} created for expense ${expenseId}`);
    
    return updatedExpense;
  }

  /**
   * Reverse journal entry when expense is cancelled/deleted
   * Similar to ERPNext's make_reverse_gl_entries
   */
  async reverseJournalEntry(journalEntryId: string, tenantId: string) {
    const journalEntry = await this.prisma.journalEntry.findUnique({
      where: { id: journalEntryId, tenantId },
      include: { lines: true },
    });

    if (!journalEntry) {
      this.logger.warn(`Journal entry ${journalEntryId} not found for reversal`);
      return;
    }

    // Create reversing entry with swapped debit/credit
    const reverseNumber = await this.generateJournalNumber(tenantId);
    
    await this.prisma.journalEntry.create({
      data: {
        tenantId,
        date: new Date(),
        number: reverseNumber,
        description: {
          en: `Reversal of ${journalEntry.number}`,
          ar: `عكس قيد ${journalEntry.number}`,
        },
        reference: journalEntry.reference,
        source: 'MANUAL',
        isPosted: true,
        totalDebit: journalEntry.totalDebit,
        totalCredit: journalEntry.totalCredit,
        createdBy: 'system',
        postedAt: new Date(),
        lines: {
          create: journalEntry.lines.map(line => ({
            tenantId,
            accountId: line.accountId,
            debit: line.credit, // Swap
            credit: line.debit, // Swap
            description: {
              en: `Reversal: ${typeof line.description === 'object' && line.description ? (line.description as any).en || '' : ''}`,
              ar: `عكس: ${typeof line.description === 'object' && line.description ? (line.description as any).ar || '' : ''}`,
            },
          })),
        },
      },
    });

    this.logger.log(`Reversed journal entry ${journalEntry.number} with ${reverseNumber}`);
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
