import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const u = await p.$queryRaw<
    Array<{ id: string; email: string | null; role: string; hash_len: number }>
  >`SELECT id, email, role, length(passwordHash) AS hash_len FROM User WHERE email='admin@crown-island.local'`;
  console.log('admin row:', u);
  const counts = {
    users: await p.user.count(),
    categories: await p.category.count(),
    services: await p.service.count(),
    priceRules: await p.priceRule.count(),
  };
  console.log('counts:', counts);
}

main().finally(() => p.$disconnect());
