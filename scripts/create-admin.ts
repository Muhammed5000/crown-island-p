import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

/**
 * Create (or update) an admin user with email + password.
 *
 * Usage:
 *   npm run admin:create -- <email> [<password>] [--role=SUPER_ADMIN]
 *
 *   If <password> is omitted you'll be prompted for it interactively.
 *
 * Examples:
 *   npm run admin:create -- admin@crown-island.local
 *   npm run admin:create -- ehab.hegazy.eg@gmail.com S3cret! --role=ADMIN
 *
 * Uses `$queryRaw` / `$executeRaw` so it works even before the Prisma client
 * has been re-generated against the new `passwordHash` column. After running
 * `npm run prisma:migrate` (or `prisma:generate`) the script still works
 * unchanged.
 */

const prisma = new PrismaClient();

type Role = 'STAFF' | 'SECURITY' | 'ADMIN' | 'SUPER_ADMIN' | 'DEVELOPER';

const VALID_ROLES: Role[] = ['STAFF', 'SECURITY', 'ADMIN', 'SUPER_ADMIN', 'DEVELOPER'];

async function main() {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const email = positional[0];
  let password = positional[1];
  if (!email) {
    console.error(
      'Usage: npm run admin:create -- <email> [<password>] [--role=STAFF|SECURITY|ADMIN|SUPER_ADMIN|DEVELOPER]',
    );
    process.exit(2);
  }

  const roleArg = process.argv.find((a) => a.startsWith('--role='));
  const role = (roleArg?.split('=')[1] ?? 'SUPER_ADMIN').toUpperCase() as Role;
  if (!VALID_ROLES.includes(role)) {
    console.error(`Invalid role: ${role}. Must be one of ${VALID_ROLES.join(', ')}.`);
    process.exit(2);
  }

  if (!password) {
    const rl = readline.createInterface({ input, output });
    password = await rl.question(`Password for ${email}: `);
    await rl.close();
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(2);
  }

  const hash = await bcrypt.hash(password, 10);
  const normalisedEmail = email.trim().toLowerCase();

  // Look up via raw SQL so this script works regardless of Prisma client state.
  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "User" WHERE LOWER("email") = ${normalisedEmail} LIMIT 1
  `;

  // Postgres: `role` is a native enum (`"UserRole"`), so the bound text value
  // must be cast explicitly (`${role}::"UserRole"`) or the insert/update fails
  // with "column is of type UserRole but expression is of type text".
  // `CURRENT_TIMESTAMP` is standard SQL and works on Postgres unchanged.
  if (existing.length === 0) {
    const id = `c${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    await prisma.$executeRaw`
      INSERT INTO "User" ("id", "email", "passwordHash", "role", "createdAt", "updatedAt")
      VALUES (${id}, ${normalisedEmail}, ${hash}, ${role}::"UserRole", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
    console.log(`Created admin: ${normalisedEmail} (role=${role})`);
  } else {
    await prisma.$executeRaw`
      UPDATE "User"
      SET "passwordHash" = ${hash},
          "role" = ${role}::"UserRole",
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${existing[0]!.id}
    `;
    console.log(`Updated admin: ${normalisedEmail} (role=${role})`);
  }

  console.log('\nSign in at /admin/login with this email + password.');
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
