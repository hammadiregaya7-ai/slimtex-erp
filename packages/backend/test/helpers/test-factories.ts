import { CreateInvoiceDto, InvoiceItemDto } from '../../src/sales/dto';

export const mockTenant = () => ({
  id: 'tenant-123',
  name: 'Test Company',
  slug: 'test-company',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
});

export const mockCustomer = (overrides?: Partial<any>) => ({
  id: 'cust-001',
  tenantId: 'tenant-123',
  name: 'Test Customer',
  email: 'customer@test.com',
  phone: '+216 71 000 000',
  address: '123 Test Street',
  taxId: 'T123456789',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

export const mockInvoiceDto = (overrides?: Partial<CreateInvoiceDto>): CreateInvoiceDto => ({
  customerId: 'cust-001',
  quoteId: undefined,
  issueDate: new Date().toISOString(),
  dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  items: [
    {
      productId: 'prod-001',
      productName: 'Test Product',
      quantity: 10,
      unitPrice: 100.0,
      discount: 0,
      total: 1000.0,
    } as InvoiceItemDto,
  ],
  subtotal: 1000.0,
  taxRate: 19,
  taxTotal: 190.0,
  total: 1190.0,
  notes: 'Test invoice notes',
  ...overrides,
});

export const mockInvoiceItemDto = (overrides?: Partial<InvoiceItemDto>): InvoiceItemDto => ({
  productId: 'prod-001',
  productName: 'Test Product',
  quantity: 5,
  unitPrice: 50.0,
  discount: 0,
  total: 250.0,
  ...overrides,
});
