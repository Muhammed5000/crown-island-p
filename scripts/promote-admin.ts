import { PrismaClient } from '@prisma/client';

/**
 * Promote a user to SUPER_ADMIN by email or phone.
 *
 * Usage:
 *   npm run admin:promote -- <email-or-phone> [--role=ADMIN|SUPER_ADMIN|STAFF]
 *
 * Examples:
 *   npm run admin:promote -- you@example.com
 *   npm run admin:promote -- +201001234567 --role=ADMIN
 *
 * The user must already exist (they've signed in at least once). For the very
 * first admin, sign in first so the row is created, then run this script.
 */
const prisma = new PrismaClient();

type Role = 'STAFF' | 'ADMIN' | 'SUPER_ADMIN' | 'DEVELOPER';

async function main() {
  const args = process.argv.slice(2);
  const identifier = args.find((a) => !a.startsWith('--'));
  if (!identifier) {
    console.error('Usage: npm run admin:promote -- <email-or-phone> [--role=ADMIN|SUPER_ADMIN|STAFF|DEVELOPER]');
    process.exit(2);
  }

  const roleArg = args.find((a) => a.startsWith('--role='));
  const requested = (roleArg?.split('=')[1] ?? 'SUPER_ADMIN').toUpperCase() as Role;
  if (!['STAFF', 'ADMIN', 'SUPER_ADMIN', 'DEVELOPER'].includes(requested)) {
    console.error(`Invalid role: ${requested}. Must be STAFF, ADMIN, SUPER_ADMIN, or DEVELOPER.`);
    process.exit(2);
  }

  const isEmail = identifier.includes('@');
  const where = isEmail ? { email: identifier.toLowerCase() } : { phone: identifier };

  const existing = await prisma.user.findFirst({ where });
  if (!existing) {
    console.error(`No user found for ${identifier}. Have they signed in yet?`);
    process.exit(1);
  }

  const updated = await prisma.user.update({
    where: { id: existing.id },
    data: { role: requested },
    select: { id: true, email: true, phone: true, name: true, role: true },
  });

  console.log('Promoted user:');
  console.log(JSON.stringify(updated, null, 2));
  console.log('\nNOTE: the user must sign out and sign back in for the JWT to pick up the new role.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
