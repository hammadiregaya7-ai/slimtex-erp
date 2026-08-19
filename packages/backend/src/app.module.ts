import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';

// Modules
import { TenantModule } from './tenant/tenant.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { ProductModule } from './product/product.module';
import { InventoryModule } from './inventory/inventory.module';
import { AccountingModule } from './accounting/accounting.module';
import { SalesModule } from './sales/sales.module';
import { PurchasingModule } from './purchasing/purchasing.module';
import { SyncModule } from './sync/sync.module';
import { WebhookModule } from './webhook/webhook.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Rate limiting
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute
        limit: 100, // 100 requests per minute
      },
    ]),

    // Redis/Bull for job queues (ETA invoices, webhooks, sync)
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),

    // Domain Modules
    TenantModule,
    AuthModule,
    UserModule,
    ProductModule,
    InventoryModule,
    AccountingModule,
    SalesModule,
    PurchasingModule,
    SyncModule,
    WebhookModule,
  ],
})
export class AppModule {}
