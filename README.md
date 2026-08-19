# Slimtex ERP Cloud

A modern, cloud-native, multi-tenant SaaS Business Management Platform (BMP) designed for Tunisian and MENA region SMEs.

## 🏗️ Architecture Overview

This is a ground-up rebuild of the legacy Slimtex ERP, pivoting from a monolithic Android-only app to a **Cloud-Native, Multi-Tenant, Omnichannel SaaS Platform**.

### Core Principles
- **Multi-Tenancy**: Shared PostgreSQL database with Row-Level Security (RLS)
- **Omnichannel**: Web Portal (Next.js) + Mobile App (Flutter - Offline First)
- **API-First**: Modular monolith with strict domain boundaries, ready for microservices
- **Tunisian Compliance**: Native integration with Tunisian Tax Authority (ETA) for E-Invoicing

## 📁 Project Structure

```
slimtex-erp/
├── apps/
│   ├── web/              # Next.js Web Portal (Admin, Accounting, Analytics)
│   └── mobile/           # Flutter Mobile App (Warehouse, Field Sales - Offline First)
├── packages/
│   ├── backend/          # NestJS API Server (Modular Monolith)
│   └── shared/           # Shared Types, Utils, i18n Keys
├── infra/                # Docker, Kubernetes, AWS ECS configs
└── README.md
```

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | NestJS (Node.js) with TypeScript |
| **Database** | PostgreSQL with Prisma ORM |
| **Web Frontend** | Next.js 14 (App Router), Tailwind CSS, shadcn/ui |
| **Mobile Frontend** | Flutter with Riverpod, Isar (Offline DB) |
| **Cache/Queue** | Redis + BullMQ |
| **Infrastructure** | Docker, AWS ECS / Kubernetes |
| **Localization** | i18next (Web), flutter_localizations (Mobile) - RTL/LTR support |

## 🚀 Key Features

### 1. Multi-Tenant Architecture
- Every table has `tenant_id` UUID for data isolation
- Row-Level Security (RLS) enforced at database level
- RBAC (Role-Based Access Control) with granular permissions

### 2. Double-Entry Accounting
- Full Chart of Accounts (COA) management
- Balanced Journal Entries (Debits = Credits)
- Audit trail for every financial transaction

### 3. Inventory Management
- Multi-warehouse support
- Stock movement audit trail
- Barcode/QR scanning (Mobile)

### 4. Offline-First Mobile Sync
- Local SQLite/Isar database on mobile
- Batched sync payloads with timestamps
- Conflict resolution for offline operations

### 5. Tunisian Market Compliance
- ETA (Electronic Tax Authority) integration hooks
- E-Invoice and E-Receipt generation
- Arabic/English bilingual support (RTL/LTR)

### 6. WhatsApp Integration
- Webhook emitters for invoice delivery
- Automated payment reminders

## 📦 Core Modules

1. **Tenant & IAM**: Organizations, Users, Roles, Permissions
2. **Product & Inventory**: SKUs, Categories, Warehouses, StockMovements
3. **Financial Core**: Chart of Accounts, Journal Entries, Ledger
4. **Sales & Purchasing**: Quotes, Invoices, POs, Payments, Receipts

## 🌍 Localization

Native support for:
- **Arabic (RTL)**: Primary language for Tunisia/MENA
- **English (LTR)**: Secondary language
- Language-agnostic JSONB storage for names/descriptions
- Real-time language toggling without page reload

## 🚧 Getting Started

### Prerequisites
- Node.js 20+
- pnpm 8+
- Docker & Docker Compose
- Flutter 3.x (for mobile development)

### Quick Start

```bash
# Install dependencies
pnpm install

# Start PostgreSQL and Redis
docker-compose up -d postgres redis

# Run database migrations
pnpm --filter @slimtex/backend prisma migrate dev

# Start backend
pnpm --filter @slimtex/backend dev

# Start web frontend
pnpm --filter @slimtex/web dev

# Start mobile app (requires Flutter)
cd apps/mobile && flutter run
```

## 📄 License

Proprietary - All rights reserved.

---

Built for Tunisian SMEs by Tunisian developers 🇹🇳
