import { PrismaClient } from '@prisma/client';

/**
 * Prisma client singleton.
 * In dev, Next.js HMR reloads modules; without a global cache we'd leak connections.
 */
declare global {
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}
