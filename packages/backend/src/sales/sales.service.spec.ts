import { Test, TestingModule } from '@nestjs/testing';
import { SalesService } from './sales.service';
import { PrismaService } from '../common/prisma.service';
import { WebhookService } from '../webhook/webhook.service';
import { Queue } from 'bull';
import { CreateInvoiceDto, InvoiceItemDto } from './dto';

describe('SalesService', () => {
  let service: SalesService;
  let prismaService: PrismaService;
  let webhookService: WebhookService;
  let etaQueue: Queue;
  let webhookQueue: Queue;
  let inventoryQueue: Queue;

  const mockPrismaService = {
    invoice: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    invoiceItem: {
      createMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    quote: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    customer: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    account: {
      findFirst: jest.fn().mockResolvedValue({ id: 'account-receivable-1' }),
    },
    tenant: {
      findUnique: jest.fn(),
    },
    product: {
      findUnique: jest.fn(),
    },
    payment: {
      create: jest.fn(),
    },
    journalEntry: {
      create: jest.fn().mockResolvedValue({ id: 'journal-entry-1' }),
    },
    journalEntryLine: {
      create: jest.fn(),
    },
    stockMovement: {
      create: jest.fn(),
    },
    warehouse: {
      findFirst: jest.fn().mockResolvedValue({ id: 'warehouse-1' }),
    },
    $transaction: jest.fn((fn) => fn(mockPrismaService)),
  };

  const mockWebhookService = {
    triggerEvent: jest.fn().mockResolvedValue(undefined),
  };

  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job-123' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: WebhookService,
          useValue: mockWebhookService,
        },
        {
          provide: 'BullQueue_eta-queue',
          useValue: mockQueue,
        },
        {
          provide: 'BullQueue_webhook-queue',
          useValue: mockQueue,
        },
        {
          provide: 'BullQueue_inventory-queue',
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
    prismaService = module.get<PrismaService>(PrismaService);
    webhookService = module.get<WebhookService>(WebhookService);
    etaQueue = module.get<Queue>('BullQueue_eta-queue');
    webhookQueue = module.get<Queue>('BullQueue_webhook-queue');
    inventoryQueue = module.get<Queue>('BullQueue_inventory-queue');

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createInvoice', () => {
    const mockTenantId = 'tenant-123';
    const mockUserId = 'user-456';
    
    const mockInvoiceDto: CreateInvoiceDto = {
      type: 'STANDARD',
      customerId: 'cust-001',
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      items: [
        {
          productId: 'prod-001',
          description: 'Test Product',
          quantity: 10,
          unitPrice: 100.0,
          taxRate: 19,
          discount: 0,
        } as InvoiceItemDto,
      ],
    };

    const mockCreatedInvoice = {
      id: 'inv-001',
      tenantId: mockTenantId,
      customerId: mockInvoiceDto.customerId,
      status: 'DRAFT',
      total: { toNumber: () => 1000 },
      taxTotal: { toNumber: () => 190 },
      subtotal: { toNumber: () => 810 },
      ...mockInvoiceDto,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(() => {
      mockPrismaService.tenant.findUnique.mockResolvedValue({ id: mockTenantId });
    });

    it('should create an invoice successfully', async () => {
      mockPrismaService.invoice.create.mockResolvedValue(mockCreatedInvoice);

      const result = await service.createInvoice(mockTenantId, mockUserId, mockInvoiceDto);

      expect(result).toEqual(mockCreatedInvoice);
      expect(mockPrismaService.invoice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: mockTenantId,
          customerId: mockInvoiceDto.customerId,
        }),
      });
    });
  });

  describe('getInvoices', () => {
    const mockTenantId = 'tenant-123';
    const mockInvoices = [
      { id: 'inv-001', tenantId: mockTenantId, total: 1000 },
      { id: 'inv-002', tenantId: mockTenantId, total: 2000 },
    ];

    it('should return all invoices for a tenant', async () => {
      mockPrismaService.invoice.findMany.mockResolvedValue(mockInvoices);

      const result = await service.getInvoices(mockTenantId);

      expect(result).toEqual(mockInvoices);
      expect(mockPrismaService.invoice.findMany).toHaveBeenCalledWith({
        where: { 
          tenantId: mockTenantId,
          status: undefined,
          type: undefined,
          customerId: undefined,
          issueDate: {
            gte: undefined,
            lte: undefined,
          },
        },
        include: {
          items: {
            include: {
              product: {
                select: {
                  sku: true,
                  name: true,
                },
              },
            },
          },
          payments: true,
        },
        orderBy: { issueDate: 'desc' },
      });
    });

    it('should support filtering by status', async () => {
      mockPrismaService.invoice.findMany.mockResolvedValue(mockInvoices);

      await service.getInvoices(mockTenantId, { status: 'SENT' });

      expect(mockPrismaService.invoice.findMany).toHaveBeenCalledWith({
        where: { 
          tenantId: mockTenantId,
          status: 'SENT',
          type: undefined,
          customerId: undefined,
          issueDate: {
            gte: undefined,
            lte: undefined,
          },
        },
        include: {
          items: {
            include: {
              product: {
                select: {
                  sku: true,
                  name: true,
                },
              },
            },
          },
          payments: true,
        },
        orderBy: { issueDate: 'desc' },
      });
    });
  });

  describe('getInvoice', () => {
    const mockTenantId = 'tenant-123';
    const mockInvoice = {
      id: 'inv-001',
      tenantId: mockTenantId,
      total: { toNumber: () => 1000 },
      items: [],
    };

    it('should return an invoice by id', async () => {
      mockPrismaService.invoice.findUnique.mockResolvedValue(mockInvoice);

      const result = await service.getInvoice(mockTenantId, 'inv-001');

      expect(result).toEqual(mockInvoice);
      expect(mockPrismaService.invoice.findUnique).toHaveBeenCalledWith({
        where: { id: 'inv-001', tenantId: mockTenantId },
        include: {
          items: {
            include: {
              product: {
                select: {
                  sku: true,
                  name: true,
                  barcode: true,
                },
              },
            },
          },
          payments: {
            orderBy: { paymentDate: 'desc' },
          },
        },
      });
    });

    it('should return null if invoice not found', async () => {
      mockPrismaService.invoice.findUnique.mockResolvedValue(null);

      const result = await service.getInvoice(mockTenantId, 'inv-999');

      expect(result).toBeNull();
    });
  });
});
