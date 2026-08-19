import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './services/expenses.service';
import { ExpenseRepository } from './repositories/expense.repository';
import { PrismaService } from '../common/prisma.service';

@Module({
  imports: [JwtModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, ExpenseRepository, PrismaService],
  exports: [ExpensesService, ExpenseRepository],
})
export class ExpensesModule {}
