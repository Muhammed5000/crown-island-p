import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isValidPhoneNumber, type CountryCode } from 'libphonenumber-js';
import { prisma } from '@/server/db/prisma';
import { isAnyIdentityBlocked } from '@/server/services/blocklist';
import { isValidRegion } from '@/lib/regions';
import { toE164 } from '@/lib/phone';
import { idColumns, isValidIdNumber } from '@/lib/national-id';
import { getMobileUser, UNAUTHORIZED } from '@/server/mobile/guard';
import { mobileMePayload } from '@/server/mobile/serialize';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';
import { log, errFields } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/me/complete-profile — the onboarding gate.
 *
 * JSON twin of the website's `completeProfile` action: full name, valid
 * phone, mandatory email, exactly one identity document (14-digit national id
 * OR 5–15 char passport) and an Egyptian governorate region. Until this
 * succeeds the app keeps the user on the complete-profile screen — the same
 * gate the web app-layout applies.
 */

const schema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(6).max(20),
    countryCode: z.string().min(2).max(3).default('EG'),
    age: z.number().int().min(16).max(120).optional().nullable(),
    isHandicapped: z.boolean().optional().default(false),
    email: z.string().trim().min(3).max(254).email().transform((s) => s.toLowerCase()),
    idType: z.enum(['national', 'passport']),
    idNumber: z.string().trim().min(1).max(30),
    region: z.string().trim().min(1).max(60),
  })
  .superRefine((data, ctx) => {
    try {
      if (!isValidPhoneNumber(data.phone, data.countryCode as CountryCode)) {
        ctx.addIssue({ code: 'custom', path: ['phone'], message: 'invalid_phone' });
      }
    } catch {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: 'invalid_phone' });
    }
    if (!isValidIdNumber(data.idType, data.idNumber)) {
      ctx.addIssue({ code: 'custom', path: ['idNumber'], message: 'invalid_id' });
    }
    if (!isValidRegion(data.region)) {
      ctx.addIssue({ code: 'custom', path: ['region'], message: 'invalid_region' });
    }
  });

export async function POST(request: Request) {
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

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    if (flat.fieldErrors.phone?.includes('invalid_phone')) {
      return NextResponse.json({ ok: false, code: 'invalid_phone' }, { status: 400 });
    }
    if (flat.fieldErrors.idNumber?.length) {
      return NextResponse.json({ ok: false, code: 'invalid_id' }, { status: 400 });
    }
    if (flat.fieldErrors.region?.length) {
      return NextResponse.json({ ok: false, code: 'invalid_region' }, { status: 400 });
    }
    if (flat.fieldErrors.email?.length) {
      return NextResponse.json({ ok: false, code: 'invalid_email' }, { status: 400 });
    }
    return NextResponse.json({ ok: false, code: 'invalid_input' }, { status: 400 });
  }

  const ids = idColumns(parsed.data.idType, parsed.data.idNumber);
  // Canonicalise to E.164 so the stored value + the phone @unique key + the ban
  // check all share one form (formatting can't bypass either).
  const phone = toE164(parsed.data.phone, parsed.data.countryCode as CountryCode);

  // Blocked identities (email / phone / national-id / passport) can never
  // complete a profile — same re-entry gate as the website.
  if (
    await isAnyIdentityBlocked([
      { kind: 'EMAIL', value: parsed.data.email },
      { kind: 'PHONE', value: phone },
      { kind: 'NATIONAL_ID', value: ids.nationalId },
      { kind: 'PASSPORT', value: ids.passportId },
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
          phone,
          email: parsed.data.email,
        },
      }),
      prisma.customerProfile.upsert({
        where: { userId: user.id },
        update: {
          fullName: parsed.data.fullName,
          phone,
          countryCode: parsed.data.countryCode,
          age: parsed.data.age ?? undefined,
          isHandicapped: parsed.data.isHandicapped,
          email: parsed.data.email,
          nationalId: ids.nationalId,
          passportId: ids.passportId,
          region: parsed.data.region,
        },
        create: {
          userId: user.id,
          fullName: parsed.data.fullName,
          phone,
          countryCode: parsed.data.countryCode,
          age: parsed.data.age ?? undefined,
          isHandicapped: parsed.data.isHandicapped,
          email: parsed.data.email,
          nationalId: ids.nationalId,
          passportId: ids.passportId,
          region: parsed.data.region,
        },
      }),
    ]);
  } catch (err) {
    const target = err as { code?: string; meta?: { target?: string[] | string } };
    if (target.code === 'P2002') {
      const fields = Array.isArray(target.meta?.target)
        ? target.meta?.target.join(',')
        : String(target.meta?.target ?? '');
      if (fields.includes('email')) {
        return NextResponse.json({ ok: false, code: 'email_taken' }, { status: 409 });
      }
      if (fields.includes('phone')) {
        return NextResponse.json({ ok: false, code: 'phone_taken' }, { status: 409 });
      }
    }
    log.error('mobile complete profile failed', errFields(err));
    return NextResponse.json({ ok: false, code: 'invalid_input' }, { status: 400 });
  }

  const me = await mobileMePayload(user.id);
  return NextResponse.json({ ok: true, user: me });
}
