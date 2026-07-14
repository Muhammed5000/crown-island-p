// Enable "count children as people" for beach (DAY_USE) services that allow
// children, so the umbrella capacity includes children per the requested rule.
// Reversible from the admin panel (Service → "count children as people").
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const targets = await prisma.service.findMany({
  where: { kind: 'DAY_USE', allowChildren: true, childrenCountAsPersons: false },
  select: { id: true, slug: true, nameEn: true },
});

if (targets.length === 0) {
  console.log('Nothing to change — no DAY_USE service has childrenCountAsPersons=false.');
} else {
  const res = await prisma.service.updateMany({
    where: { id: { in: targets.map((s) => s.id) } },
    data: { childrenCountAsPersons: true },
  });
  for (const s of targets) console.log(`[on] ${s.slug} (${s.nameEn}) -> count children as people`);
  console.log(`Updated ${res.count} service(s).`);
}

await prisma.$disconnect();
