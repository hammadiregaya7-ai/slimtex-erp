import { PrismaClient } from '@prisma/client';
import { Module, Global } from '@nestjs/common';

const prismaClientSingleton = () => {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
};

declare global {
  // eslint-disable-next-line no-var
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

export const prisma = globalThis.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma;

export class PrismaService extends PrismaClient {}

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
