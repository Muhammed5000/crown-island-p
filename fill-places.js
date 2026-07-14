const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const services = await prisma.service.findMany({ where: { placeAssignmentRequired: true } });
  let total = 0;
  for (const s of services) {
    const cap = s.dailyCapacityPeople || 10;
    const existing = await prisma.servicePlace.count({ where: { serviceId: s.id } });
    if (existing === 0) {
      const rows = Array.from({ length: cap }, (_, i) => ({
        serviceId: s.id,
        label: `${s.placeType.charAt(0)}${i + 1}`,
        type: s.placeType,
        zone: 'Main',
        position: i + 1,
      }));
      await prisma.servicePlace.createMany({ data: rows });
      total += rows.length;
      console.log(`Added ${rows.length} places for ${s.nameEn}`);
    }
  }
  console.log(`Total added: ${total}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
