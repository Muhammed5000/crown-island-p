import { prisma } from '@/server/db/prisma';

function fixtureTag(prefix: string) {
  return `${prefix}-${process.pid}-${process.hrtime.bigint().toString()}`;
}

export async function createSyncTestUser(prefix: string) {
  const tag = fixtureTag(prefix);
  const user = await prisma.user.create({
    data: {
      email: `${tag}@example.test`,
      name: 'Sync integration fixture',
      // The sync contract only needs a non-empty stored credential snapshot.
      // This is deliberately not a usable password hash.
      passwordHash: 'test-only-non-credential-hash',
    },
  });

  return {
    user,
    async cleanup() {
      await prisma.user.deleteMany({ where: { id: user.id } });
    },
  };
}

export async function createSyncTestBooking(prefix: string) {
  const service = await prisma.service.findFirstOrThrow({ select: { id: true } });
  const userFixture = await createSyncTestUser(prefix);
  const tag = fixtureTag(prefix);

  try {
    const booking = await prisma.booking.create({
      data: {
        reference: `TEST-${tag}`,
        userId: userFixture.user.id,
        serviceId: service.id,
        bookingDate: new Date('2099-02-01T00:00:00.000Z'),
        people: 1,
        adults: 1,
        cars: 0,
        clientRequestId: tag,
      },
    });

    return {
      booking,
      async cleanup() {
        await prisma.bookingLocalState.deleteMany({
          where: { OR: [{ id: booking.id }, { bookingId: booking.id }] },
        });
        await prisma.booking.deleteMany({ where: { id: booking.id } });
        await userFixture.cleanup();
      },
    };
  } catch (error) {
    await userFixture.cleanup();
    throw error;
  }
}
