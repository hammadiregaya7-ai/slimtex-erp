import { jest } from '@jest/globals';

export const mockInvoiceRepository = {
  findMany: jest.fn(),
  findById: jest.fn(),
  findByTenant: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  updateStatus: jest.fn(),
  markAsPaid: jest.fn(),
  void: jest.fn(),
  delete: jest.fn(),
};

export const mockQuoteRepository = {
  findMany: jest.fn(),
  findById: jest.fn(),
  findByTenant: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  updateStatus: jest.fn(),
  convertToInvoice: jest.fn(),
  delete: jest.fn(),
};

export const mockSalesItemRepository = {
  createMany: jest.fn(),
  updateMany: jest.fn(),
  deleteByParent: jest.fn(),
};

export const mockCustomerRepository = {
  findById: jest.fn(),
  findByTenant: jest.fn(),
  exists: jest.fn(),
};

export const mockPricingService = {
  calculateLineItemTotal: jest.fn(),
  calculateInvoiceTotals: jest.fn(),
  applyDiscount: jest.fn(),
  calculateTax: jest.fn(),
};

export const mockInventoryReservationService = {
  checkAvailability: jest.fn(),
  reserveStock: jest.fn(),
  releaseReservation: jest.fn(),
  confirmReservation: jest.fn(),
};

export const mockInvoiceLifecycleService = {
  canTransition: jest.fn(),
  transitionToSent: jest.fn(),
  transitionToPaid: jest.fn(),
  transitionToVoid: jest.fn(),
  validateBeforeSending: jest.fn(),
};

export const mockConversionService = {
  convertQuoteToInvoice: jest.fn(),
  validateConversion: jest.fn(),
};

// Reset all mocks between tests
export const resetAllMocks = () => {
  Object.values(mockInvoiceRepository).forEach((fn) => fn.mockReset());
  Object.values(mockQuoteRepository).forEach((fn) => fn.mockReset());
  Object.values(mockSalesItemRepository).forEach((fn) => fn.mockReset());
  Object.values(mockCustomerRepository).forEach((fn) => fn.mockReset());
  Object.values(mockPricingService).forEach((fn) => fn.mockReset());
  Object.values(mockInventoryReservationService).forEach((fn) => fn.mockReset());
  Object.values(mockInvoiceLifecycleService).forEach((fn) => fn.mockReset());
  Object.values(mockConversionService).forEach((fn) => fn.mockReset());
};
