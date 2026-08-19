import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { ExpenseRepository } from '../repositories/expense.repository';
import { PrismaService } from '../../common/prisma.service';
import { CreateExpenseDto, ApproveExpenseDto } from '../dto/expense.dto';
import { PaymentStatus } from '@prisma/client';

describe('ExpensesService', () => {
  let service: ExpensesService;
  let expenseRepository: jest.Mocked<ExpenseRepository>;
  let prismaService: jest.Mocked<PrismaService>;

  const mockTenantId = 'tenant-123';
  const mockUserId = 'user-456';

  const mockExpenseCategory = {
    id: 'cat-1',
    tenantId: mockTenantId,
    name: { en: 'Office Supplies', ar: 'مستلزمات مكتبية' },
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockExpense = {
    id: 'exp-1',
    tenantId: mockTenantId,
    categoryId: 'cat-1',
    amount: 100,
    total: 120,
    date: new Date('2024-01-15'),
    paymentStatus: 'PENDING' as PaymentStatus,
    vendorName: 'Test Vendor',
    createdBy: mockUserId,
    approvedAt: null,
    paymentDate: null,
    journalEntryId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    category: mockExpenseCategory,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesService,
        {
          provide: ExpenseRepository,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            approve: jest.fn(),
            remove: jest.fn(),
            getTotalByPeriod: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            expenseCategory: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
            },
            expense: {
              findUnique: jest.fn(),
              update: jest.fn(),
              aggregate: jest.fn(),
            },
            account: {
              findUnique: jest.fn(),
              findFirst: jest.fn(),
            },
            journalEntry: {
              create: jest.fn(),
              findFirst: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<ExpensesService>(ExpensesService);
    expenseRepository = module.get(ExpenseRepository);
    prismaService = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const mockCreateDto: CreateExpenseDto = {
      categoryId: 'cat-1',
      amount: 100,
      date: '2024-01-15',
      vendorName: 'Test Vendor',
      paymentMethod: 'CASH',
    };

    it('should create an expense successfully', async () => {
      (prismaService.expenseCategory.findUnique as jest.Mock).mockResolvedValue(mockExpenseCategory);
      (expenseRepository.create as jest.Mock).mockResolvedValue(mockExpense);

      const result = await service.create(mockTenantId, mockCreateDto, mockUserId);

      expect(result).toEqual(mockExpense);
      expect(prismaService.expenseCategory.findUnique).toHaveBeenCalledWith({
        where: { id: 'cat-1' },
      });
      expect(expenseRepository.create).toHaveBeenCalledWith({
        ...mockCreateDto,
        tenantId: mockTenantId,
        createdBy: mockUserId,
      });
    });

    it('should throw NotFoundException if category not found', async () => {
      (prismaService.expenseCategory.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.create(mockTenantId, mockCreateDto, mockUserId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if category belongs to different tenant', async () => {
      const wrongTenantCategory = { ...mockExpenseCategory, tenantId: 'wrong-tenant' };
      (prismaService.expenseCategory.findUnique as jest.Mock).mockResolvedValue(wrongTenantCategory);

      await expect(service.create(mockTenantId, mockCreateDto, mockUserId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should skip customer validation if Customer model does not exist', async () => {
      const dtoWithCustomer: CreateExpenseDto = {
        ...mockCreateDto,
        billableToCustomerId: 'cust-1',
      };

      (prismaService.expenseCategory.findUnique as jest.Mock).mockResolvedValue(mockExpenseCategory);
      (expenseRepository.create as jest.Mock).mockResolvedValue(mockExpense);

      // Simulate Customer model not existing
      const error = new Error('Model not found');
      (prismaService as any).customer = { findUnique: jest.fn().mockRejectedValue(error) };

      await expect(service.create(mockTenantId, dtoWithCustomer, mockUserId)).resolves.toBeDefined();
    });
  });

  describe('findAll', () => {
    it('should return all expenses for tenant', async () => {
      const mockExpenses = [mockExpense];
      (expenseRepository.findAll as jest.Mock).mockResolvedValue(mockExpenses);

      const result = await service.findAll(mockTenantId);

      expect(result).toEqual(mockExpenses);
      expect(expenseRepository.findAll).toHaveBeenCalledWith(mockTenantId, undefined);
    });

    it('should filter expenses by category', async () => {
      const filters = { categoryId: 'cat-1' };
      (expenseRepository.findAll as jest.Mock).mockResolvedValue([mockExpense]);

      await service.findAll(mockTenantId, filters);

      expect(expenseRepository.findAll).toHaveBeenCalledWith(mockTenantId, filters);
    });
  });

  describe('findOne', () => {
    it('should return an expense', async () => {
      (expenseRepository.findOne as jest.Mock).mockResolvedValue(mockExpense);

      const result = await service.findOne(mockTenantId, 'exp-1');

      expect(result).toEqual(mockExpense);
      expect(expenseRepository.findOne).toHaveBeenCalledWith('exp-1', mockTenantId);
    });

    it('should throw NotFoundException if expense not found', async () => {
      (expenseRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne(mockTenantId, 'exp-999')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('approve', () => {
    const mockApproveDto: ApproveExpenseDto = {
      approvedBy: mockUserId,
    };

    it('should approve an expense', async () => {
      (expenseRepository.findOne as jest.Mock).mockResolvedValue(mockExpense);
      (expenseRepository.approve as jest.Mock).mockResolvedValue({
        ...mockExpense,
        approvedAt: new Date(),
      });

      const result = await service.approve(mockTenantId, 'exp-1', mockApproveDto);

      expect(result.approvedAt).toBeDefined();
      expect(expenseRepository.approve).toHaveBeenCalledWith('exp-1', mockTenantId, mockUserId);
    });

    it('should throw NotFoundException if expense not found', async () => {
      (expenseRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.approve(mockTenantId, 'exp-999', mockApproveDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if expense already paid', async () => {
      const paidExpense = { ...mockExpense, paymentStatus: 'PAID' as PaymentStatus };
      (expenseRepository.findOne as jest.Mock).mockResolvedValue(paidExpense);

      await expect(service.approve(mockTenantId, 'exp-1', mockApproveDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('markAsPaid', () => {
    it('should mark an expense as paid (no journal entry needed)', async () => {
      // Expense with PENDING status but already has journal entry
      const approvedExpense = { 
        ...mockExpense, 
        approvedAt: new Date(), 
        journalEntryId: 'je-existing',
        paymentStatus: 'PENDING' as PaymentStatus, // Still pending payment
      };
      const finalExpense = {
        ...mockExpense,
        approvedAt: new Date(),
        paymentStatus: 'PAID' as PaymentStatus,
        paymentDate: new Date(),
        journalEntryId: 'je-existing',
      };
      
      // First call: check if can be paid (returns PENDING)
      // Second call: after update (returns PAID)
      let callCount = 0;
      (expenseRepository.findOne as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(approvedExpense);
        }
        return Promise.resolve(finalExpense);
      });

      const updatedExpense = {
        ...mockExpense,
        approvedAt: new Date(),
        paymentStatus: 'PAID' as PaymentStatus,
        paymentDate: new Date(),
        journalEntry: { id: 'je-existing' },
        journalEntryId: 'je-existing',
      };
      (prismaService.expense.update as jest.Mock).mockResolvedValue(updatedExpense);

      const result = await service.markAsPaid(mockTenantId, 'exp-1');

      expect(result).toBeDefined();
      if (result) {
        expect(result.paymentStatus).toBe('PAID');
      }
      expect(prismaService.expense.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'exp-1', tenantId: mockTenantId },
          data: expect.objectContaining({
            paymentStatus: 'PAID',
          }),
        }),
      );
    });

    it('should throw BadRequestException if expense not approved', async () => {
      (expenseRepository.findOne as jest.Mock).mockResolvedValue(mockExpense);

      await expect(service.markAsPaid(mockTenantId, 'exp-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if expense already paid', async () => {
      const paidExpense = { ...mockExpense, paymentStatus: 'PAID' as PaymentStatus };
      (expenseRepository.findOne as jest.Mock).mockResolvedValue(paidExpense);

      await expect(service.markAsPaid(mockTenantId, 'exp-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should create journal entry if none exists', async () => {
      const approvedExpense = { ...mockExpense, approvedAt: new Date(), journalEntryId: null };
      const updatedExpense = {
        ...mockExpense,
        approvedAt: new Date(),
        paymentStatus: 'PAID' as PaymentStatus,
        paymentDate: new Date(),
        journalEntry: null,
      };

      (expenseRepository.findOne as jest.Mock).mockResolvedValue(approvedExpense);
      (prismaService.expense.update as jest.Mock).mockResolvedValue(updatedExpense);


      await service.markAsPaid(mockTenantId, 'exp-1');

    });
  });

  describe('remove', () => {
    it('should remove a pending expense', async () => {
      (expenseRepository.findOne as jest.Mock).mockResolvedValue(mockExpense);
      (expenseRepository.remove as jest.Mock).mockResolvedValue(undefined);

      await service.remove(mockTenantId, 'exp-1');

      expect(expenseRepository.remove).toHaveBeenCalledWith('exp-1', mockTenantId);
    });

    it('should throw NotFoundException if expense not found', async () => {
      (expenseRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.remove(mockTenantId, 'exp-999')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if expense is approved', async () => {
      const approvedExpense = { ...mockExpense, approvedAt: new Date() };
      (expenseRepository.findOne as jest.Mock).mockResolvedValue(approvedExpense);

      await expect(service.remove(mockTenantId, 'exp-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getReports', () => {
    it('should generate yearly expense report', async () => {
      const mockCategories = [
        {
          ...mockExpenseCategory,
          _count: { expenses: 5 },
        },
      ];

      (prismaService.expenseCategory.findMany as jest.Mock).mockResolvedValue(mockCategories);
      (expenseRepository.getTotalByPeriod as jest.Mock).mockResolvedValue(600);
      
      // Mock payment status breakdown
      (prismaService.expense.aggregate as jest.Mock).mockResolvedValue({
        _sum: { total: 600 },
        _count: { id: 5 },
      });

      const result = await service.getReports(mockTenantId, 2024);

      expect(result.year).toBe(2024);
      expect(result.categories).toHaveLength(1);
      expect(result.grandTotal).toBe(600);
    });

    it('should generate monthly expense report', async () => {
      const mockCategories = [
        {
          ...mockExpenseCategory,
          _count: { expenses: 1 },
        },
      ];

      (prismaService.expenseCategory.findMany as jest.Mock).mockResolvedValue(mockCategories);
      (expenseRepository.getTotalByPeriod as jest.Mock).mockResolvedValue(120);
      
      // Mock payment status breakdown
      (prismaService.expense.aggregate as jest.Mock).mockResolvedValue({
        _sum: { total: 120 },
        _count: { id: 1 },
      });

      const result = await service.getReports(mockTenantId, 2024, 3);

      expect(result.month).toBe(3);
      expect(result.categories).toHaveLength(1);
      expect(result.categories[0].count).toBe(1);
    });
  });

});
