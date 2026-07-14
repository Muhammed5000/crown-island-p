import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const res = await prisma.user.updateMany({
    where: {
      role: { in: ['TESTER', 'ADMIN', 'SUPER_ADMIN', 'DEVELOPER', 'STAFF'] },
      emailVerified: null,
    },
    data: {
      emailVerified: new Date(),
    },
  });

  console.log(`Verified ${res.count} existing administrative/testing accounts.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
