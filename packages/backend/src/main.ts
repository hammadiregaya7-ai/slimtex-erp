import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for frontend
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // API prefix
  app.setGlobalPrefix('api/v1');

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Slimtex ERP Cloud API')
    .setDescription('API for the Slimtex ERP Cloud - Multi-tenant SaaS ERP for Tunisian SMEs')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('auth', 'Authentication & Authorization')
    .addTag('tenants', 'Tenant Management')
    .addTag('users', 'User Management')
    .addTag('products', 'Product & Inventory')
    .addTag('accounting', 'Double-Entry Accounting')
    .addTag('sales', 'Sales & Invoices')
    .addTag('purchasing', 'Purchase Orders')
    .addTag('sync', 'Offline Sync for Mobile')
    .addTag('webhooks', 'Webhook Management')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  // Graceful shutdown
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const port = configService.get('PORT') || 3001;

  await app.listen(port);
  console.log(`🚀 Slimtex ERP API running on: http://localhost:${port}`);
  console.log(`📚 API Documentation: http://localhost:${port}/docs`);
}

bootstrap();
