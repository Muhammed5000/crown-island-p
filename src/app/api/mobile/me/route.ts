import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isValidPhoneNumber, type CountryCode } from 'libphonenumber-js';
import { prisma } from '@/server/db/prisma';
import { isAnyIdentityBlocked } from '@/server/services/blocklist';
import { isValidRegion } from '@/lib/regions';
import { idColumns, isValidIdNumber } from '@/lib/national-id';
import { toE164 } from '@/lib/phone';
import { getMobileUser, UNAUTHORIZED } from '@/server/mobile/guard';
import { mobileMePayload } from '@/server/mobile/serialize';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';
import { log, errFields } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /api/mobile/me
 *
 *  - GET — current user + customer profile + `profileComplete` flag.
 *  - PATCH — settings-screen profile update. JSON twin of the website's
 *    `updateProfileAction`: name/phone/countryCode/age/isHandicapped are
 *    required; identity document + region are optional and preserved when
 *    omitted (they're enforced at onboarding via complete-profile).
 */

export async function GET(request: Request) {
  // TEMPORARILY DISABLED: Mobile application API delivery is currently disabled.
  // Keep this code for future re-enable. Do not delete.
  // Disabled by request: "disable all the api that deliver to mobile application comment it for now until we enable it later"
  if (MOBILE_API_DISABLED) return mobileApiDisabled();
  const user = await getMobileUser(request);
  if (!user) return NextResponse.json(UNAUTHORIZED, { status: 401 });

  const me = await mobileMePayload(user.id);
  if (!me) return NextResponse.json(UNAUTHORIZED, { status: 401 });
  return NextResponse.json({ ok: true, user: me });
}

const updateSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(6).max(20),
    countryCode: z.string().min(2).max(3).default('EG'),
    age: z.number().int().min(16).max(120).optional().nullable(),
    isHandicapped: z.boolean().optional().default(false),
    idType: z.enum(['national', 'passport']).optional(),
    idNumber: z.string().trim().max(30).optional(),
    region: z.string().trim().max(60).optional(),
  })
  .superRefine((data, ctx) => {
    try {
      if (!isValidPhoneNumber(data.phone, data.countryCode as CountryCode)) {
        ctx.addIssue({ code: 'custom', path: ['phone'], message: 'invalid_phone' });
      }
    } catch {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: 'invalid_phone' });
    }
  });

export async function PATCH(request: Request) {
  // TEMPORARILY DISABLED: Mobile application API delivery is currently disabled.
  // Keep this code for future re-enable. Do not delete.
  // Disabled by request: "disable all the api that deliver to mobile application comment it for now until we enable it later"
  if (MOBILE_API_DISABLED) return mobileApiDisabled();
  const user = await getMobileUser(request);
  if (!user) return NextResponse.json(UNAUTHORIZED, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: 'invalid_input' }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    if (flat.fieldErrors.phone?.includes('invalid_phone')) {
      return NextResponse.json({ ok: false, code: 'invalid_phone' }, { status: 400 });
    }
    return NextResponse.json({ ok: false, code: 'invalid_input' }, { status: 400 });
  }

  // Identity document + region only validated/updated when actually provided.
  const idRegionData: { nationalId?: string | null; passportId?: string | null; region?: string } = {};
  if (parsed.data.idNumber) {
    const idType = parsed.data.idType === 'passport' ? 'passport' : 'national';
    if (!isValidIdNumber(idType, parsed.data.idNumber)) {
      return NextResponse.json({ ok: false, code: 'invalid_id' }, { status: 400 });
    }
    Object.assign(idRegionData, idColumns(idType, parsed.data.idNumber));
  }
  if (parsed.data.region) {
    if (!isValidRegion(parsed.data.region)) {
      return NextResponse.json({ ok: false, code: 'invalid_region' }, { status: 400 });
    }
    idRegionData.region = parsed.data.region;
  }

  // Canonicalise to E.164 BEFORE the blocklist check and the writes — matching
  // every other identity path (complete-profile, web updateProfile). Storing/
  // comparing a raw format would let a banned number re-enter under a different
  // spelling and defeat the `phone @unique` intent.
  const phoneE164 = toE164(parsed.data.phone, parsed.data.countryCode as CountryCode);

  if (
    await isAnyIdentityBlocked([
      { kind: 'PHONE', value: phoneE164 },
      { kind: 'NATIONAL_ID', value: idRegionData.nationalId },
      { kind: 'PASSPORT', value: idRegionData.passportId },
    ])
  ) {
    return NextResponse.json({ ok: false, code: 'invalid_input' }, { status: 400 });
  }

  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          name: parsed.data.fullName,
          phone: phoneE164,
        },
      }),
      prisma.customerProfile.upsert({
        where: { userId: user.id },
        update: {
          fullName: parsed.data.fullName,
          phone: phoneE164,
          countryCode: parsed.data.countryCode,
          age: parsed.data.age ?? undefined,
          isHandicapped: parsed.data.isHandicapped,
          ...idRegionData,
        },
        create: {
          userId: user.id,
          fullName: parsed.data.fullName,
          phone: phoneE164,
          countryCode: parsed.data.countryCode,
          age: parsed.data.age ?? undefined,
          isHandicapped: parsed.data.isHandicapped,
          email: user.email,
          ...idRegionData,
        },
      }),
    ]);
  } catch (err) {
    const dbErr = err as { code?: string };
    if (dbErr.code === 'P2002') {
      return NextResponse.json({ ok: false, code: 'phone_taken' }, { status: 409 });
    }
    log.error('mobile profile update failed', errFields(err));
    return NextResponse.json({ ok: false, code: 'update_failed' }, { status: 500 });
  }

  const me = await mobileMePayload(user.id);
  return NextResponse.json({ ok: true, user: me });
}
