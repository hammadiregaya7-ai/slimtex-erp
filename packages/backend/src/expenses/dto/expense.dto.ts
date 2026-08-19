import {
  IsString,
  IsNumber,
  IsOptional,
  IsDateString,
  IsEnum,
  Min,
  Max,
  IsUUID,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod, PaymentStatus } from '@prisma/client';

export class CreateExpenseDto {
  @ApiProperty({ description: 'Expense category ID', example: 'uuid' })
  @IsUUID()
  categoryId: string;

  @ApiProperty({ description: 'Expense date', example: '2024-01-15' })
  @IsDateString()
  date: string;

  @ApiProperty({ description: 'Pre-tax amount', example: 100.00 })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiPropertyOptional({ description: 'Tax rate percentage', example: 19 })
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number = 0;

  @ApiPropertyOptional({ description: 'Vendor name', example: 'Office Supplies Co.' })
  @IsString()
  vendorName?: string;

  @ApiPropertyOptional({ description: 'Vendor tax ID', example: 'TAX123456' })
  @IsString()
  vendorTaxId?: string;

  @ApiPropertyOptional({ description: 'Vendor invoice number', example: 'INV-2024-001' })
  @IsString()
  invoiceNumber?: string;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.CASH })
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod = PaymentMethod.CASH;

  @ApiPropertyOptional({ enum: PaymentStatus, default: PaymentStatus.PENDING })
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus = PaymentStatus.PENDING;

  @ApiPropertyOptional({ description: 'Payment date', example: '2024-01-15' })
  @IsDateString()
  paymentDate?: string;

  @ApiPropertyOptional({ description: 'Expense notes', example: { en: 'Office supplies for Q1' } })
  @IsOptional()
  notes?: any;

  @ApiPropertyOptional({ description: 'Receipt image URLs', example: ['https://...'] })
  @IsArray()
  @IsString({ each: true })
  attachments?: string[] = [];

  @ApiPropertyOptional({ description: 'Customer ID if billable' })
  @IsUUID()
  billableToCustomerId?: string;

  @ApiPropertyOptional({ description: 'Project ID' })
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Created by user ID' })
  @IsString()
  createdBy?: string;
}

export class UpdateExpenseDto {
  @ApiPropertyOptional({ description: 'Expense category ID' })
  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Expense date' })
  @IsDateString()
  @IsOptional()
  date?: string;

  @ApiPropertyOptional({ description: 'Pre-tax amount' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  amount?: number;

  @ApiPropertyOptional({ description: 'Tax rate percentage' })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  taxRate?: number;

  @ApiPropertyOptional({ description: 'Vendor name' })
  @IsString()
  @IsOptional()
  vendorName?: string;

  @ApiPropertyOptional({ description: 'Vendor tax ID' })
  @IsString()
  @IsOptional()
  vendorTaxId?: string;

  @ApiPropertyOptional({ description: 'Vendor invoice number' })
  @IsString()
  @IsOptional()
  invoiceNumber?: string;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  @IsOptional()
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsEnum(PaymentStatus)
  @IsOptional()
  paymentStatus?: PaymentStatus;

  @ApiPropertyOptional({ description: 'Payment date' })
  @IsDateString()
  @IsOptional()
  paymentDate?: string;

  @ApiPropertyOptional({ description: 'Expense notes' })
  @IsOptional()
  notes?: any;

  @ApiPropertyOptional({ description: 'Receipt image URLs' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  attachments?: string[];

  @ApiPropertyOptional({ description: 'Customer ID if billable' })
  @IsUUID()
  @IsOptional()
  billableToCustomerId?: string;

  @ApiPropertyOptional({ description: 'Project ID' })
  @IsString()
  @IsOptional()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Approving user ID' })
  @IsString()
  @IsOptional()
  approvedBy?: string;
}

export class ApproveExpenseDto {
  @ApiProperty({ description: 'User ID approving the expense' })
  @IsString()
  approvedBy: string;
}

export class CreateExpenseCategoryDto {
  @ApiProperty({ description: 'Category name (localized)', example: { en: 'Travel', ar: 'السفر' } })
  @IsOptional()
  name?: any = { en: 'Uncategorized' };

  @ApiPropertyOptional({ description: 'Category code', example: 'TRV' })
  @IsString()
  code?: string;

  @ApiPropertyOptional({ description: 'Category description', example: { en: 'Travel expenses' } })
  @IsOptional()
  description?: any;

  @ApiPropertyOptional({ description: 'Parent category ID for hierarchy' })
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ description: 'UI color', example: '#FF5733' })
  @IsString()
  color?: string;
}

export class UpdateExpenseCategoryDto {
  @ApiPropertyOptional({ description: 'Category name' })
  @IsOptional()
  name?: any;

  @ApiPropertyOptional({ description: 'Category code' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ description: 'Category description' })
  @IsOptional()
  description?: any;

  @ApiPropertyOptional({ description: 'Parent category ID' })
  @IsUUID()
  @IsOptional()
  parentId?: string;

  @ApiPropertyOptional({ description: 'UI color' })
  @IsString()
  @IsOptional()
  color?: string;

  @ApiPropertyOptional({ description: 'Whether category is active' })
  @IsOptional()
  isActive?: boolean;
}
