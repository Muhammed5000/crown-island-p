import 'server-only';
import type { EmailMessage } from './provider';

/**
 * Plain-text + HTML templates for transactional emails.
 *
 * Brand voice mirrors the rest of the product — "Crown Island", warm tone,
 * short paragraphs. Links must work in plain-text clients, so each template
 * exposes the URL on its own line.
 *
 * Keep these self-contained: no imports from `next-intl` because translation
 * loading on the server uses a different boot path than the public app.
 */

function brandFooter(year: number) {
  return [
    '—',
    `Crown Island · El Montazah`,
    `© ${year} — all rights reserved`,
  ].join('\n');
}

function brandFooterAr(year: number) {
  return [
    '—',
    `كراون آيلاند · المنتزه`,
    `© ${year} — جميع الحقوق محفوظة`,
  ].join('\n');
}

export interface BookingConfirmationArgs {
  to: string;
  /** Display name for the greeting. */
  name: string;
  locale: 'ar' | 'en';
  reference: string;
  serviceName: string;
  /** Pre-formatted, locale-aware date (single day or range). */
  dateLabel: string;
  /** Pre-formatted guest count, e.g. "4 guests" / "٤ ضيوف". */
  peopleLabel: string;
  /** Pre-formatted, locale-aware total, e.g. "EGP 1,200.00". */
  totalLabel: string;
  /** Absolute URL to the customer's booking detail page. */
  manageUrl: string;
}

/** Minimal HTML escaping for values interpolated into email markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface SummaryRow {
  label: string;
  value: string;
  /** Render the value left-to-right (reference codes / amounts) even in RTL. */
  ltrValue?: boolean;
  /** Highlight the row — used for the total. */
  emphasize?: boolean;
}

interface ConfirmationHtmlOpts {
  dir: 'rtl' | 'ltr';
  title: string;
  greeting: string;
  intro: string;
  rows: SummaryRow[];
  ctaLabel: string;
  ctaUrl: string;
  closing: string;
  footerLines: string[];
  preheader: string;
}

/**
 * Elegant, email-client-safe HTML for the booking-confirmation message. Pure
 * table layout + inline styles (the only thing that survives Gmail/Outlook),
 * direction-aware so the Arabic edition reads right-to-left.
 */
function confirmationHtml(o: ConfirmationHtmlOpts): string {
  const start = o.dir === 'rtl' ? 'right' : 'left';
  const end = o.dir === 'rtl' ? 'left' : 'right';
  const font =
    o.dir === 'rtl'
      ? "'Segoe UI', Tahoma, Arial, sans-serif"
      : "'Segoe UI', Helvetica, Arial, sans-serif";

  const rows = o.rows
    .map((r, i) => {
      const border = i === o.rows.length - 1 ? '' : 'border-bottom:1px solid #f0ece2;';
      const bg = r.emphasize ? 'background:#faf6ea;' : '';
      const labStyle = `padding:13px 18px;text-align:${start};font-size:13px;color:#6b7280;${border}`;
      const valStyle =
        `padding:13px 18px;text-align:${end};${border}` +
        (r.emphasize
          ? 'font-size:17px;font-weight:700;color:#b8902f;'
          : 'font-size:14px;font-weight:600;color:#1f2937;') +
        (r.ltrValue ? 'direction:ltr;unicode-bidi:isolate;' : '');
      return `<tr style="${bg}"><td style="${labStyle}">${escapeHtml(r.label)}</td><td style="${valStyle}">${escapeHtml(r.value)}</td></tr>`;
    })
    .join('');

  const footer = o.footerLines.map(escapeHtml).join('<br/>');

  return `<!DOCTYPE html><html dir="${o.dir}" lang="${o.dir === 'rtl' ? 'ar' : 'en'}"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f1ea;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:28px 12px;font-family:${font};">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e7e2d6;border-radius:18px;overflow:hidden;">
<tr><td style="background:#0f2138;padding:30px 32px;text-align:center;">
<div style="font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:700;letter-spacing:3px;color:#e9d9a8;">CROWN ISLAND</div>
<div style="font-size:11px;letter-spacing:5px;color:#9fb0c4;margin-top:7px;">EL MONTAZAH</div>
</td></tr>
<tr><td style="height:4px;background:#b8902f;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td dir="${o.dir}" style="padding:34px 32px 6px;text-align:center;">
<div style="display:inline-block;width:58px;height:58px;line-height:58px;border-radius:50%;background:#eaf6ef;color:#2f9e63;font-size:30px;">&#10003;</div>
<h1 style="margin:18px 0 0;font-family:Georgia,serif;font-size:23px;font-weight:600;color:#0f2138;">${escapeHtml(o.title)}</h1>
</td></tr>
<tr><td dir="${o.dir}" style="padding:14px 36px 0;text-align:${start};">
<p style="margin:8px 0 0;font-size:15px;line-height:1.7;color:#374151;">${escapeHtml(o.greeting)}</p>
<p style="margin:10px 0 0;font-size:15px;line-height:1.7;color:#374151;">${escapeHtml(o.intro)}</p>
</td></tr>
<tr><td dir="${o.dir}" style="padding:22px 32px 4px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ece6da;border-radius:12px;border-collapse:separate;overflow:hidden;">${rows}</table>
</td></tr>
<tr><td style="padding:24px 32px 6px;text-align:center;">
<a href="${escapeHtml(o.ctaUrl)}" style="display:inline-block;background:#b8902f;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;letter-spacing:0.5px;padding:14px 34px;border-radius:10px;">${escapeHtml(o.ctaLabel)}</a>
</td></tr>
<tr><td dir="${o.dir}" style="padding:18px 36px 8px;text-align:center;">
<p style="margin:0;font-size:13px;line-height:1.7;color:#6b7280;">${escapeHtml(o.closing)}</p>
</td></tr>
<tr><td style="padding:22px 32px 28px;text-align:center;border-top:1px solid #ece6da;">
<div style="font-size:12px;color:#9aa1ab;line-height:1.9;">${footer}</div>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/** Booking confirmed + paid — the trust-closing email sent after a successful payment. */
export function bookingConfirmationTemplate(args: BookingConfirmationArgs): EmailMessage {
  const year = new Date().getFullYear();

  if (args.locale === 'ar') {
    const text = [
      `مرحباً ${args.name}،`,
      ``,
      `يسعدنا إبلاغك بأن حجزك في كراون آيلاند قد تم تأكيده بنجاح. ✅`,
      ``,
      `تفاصيل الحجز:`,
      `رقم الحجز: ${args.reference}`,
      `الخدمة: ${args.serviceName}`,
      `التاريخ: ${args.dateLabel}`,
      `عدد الضيوف: ${args.peopleLabel}`,
      `الإجمالي المدفوع: ${args.totalLabel}`,
      ``,
      `لعرض حجزك ورمز الدخول (QR):`,
      args.manageUrl,
      ``,
      `نتطلّع لاستقبالكم. يُرجى إحضار رمز الدخول وإثبات هوية لكل ضيف عند البوابة.`,
      ``,
      brandFooterAr(year),
    ].join('\n');
    const html = confirmationHtml({
      dir: 'rtl',
      title: 'تم تأكيد حجزك',
      greeting: `مرحباً ${args.name}،`,
      intro: 'يسعدنا إبلاغك بأن حجزك في كراون آيلاند قد تم تأكيده بنجاح. وفيما يلي تفاصيل حجزك:',
      rows: [
        { label: 'رقم الحجز', value: args.reference, ltrValue: true },
        { label: 'الخدمة', value: args.serviceName },
        { label: 'التاريخ', value: args.dateLabel },
        { label: 'عدد الضيوف', value: args.peopleLabel },
        { label: 'الإجمالي المدفوع', value: args.totalLabel, emphasize: true },
      ],
      ctaLabel: 'عرض الحجز ورمز الدخول',
      ctaUrl: args.manageUrl,
      closing: 'نتطلّع لاستقبالكم. يُرجى إحضار رمز الدخول (QR) وإثبات هوية لكل ضيف عند البوابة.',
      footerLines: ['كراون آيلاند · المنتزه', `© ${year} — جميع الحقوق محفوظة`],
      preheader: `تم تأكيد حجزك في كراون آيلاند — ${args.reference}`,
    });
    return {
      to: args.to,
      subject: `كراون آيلاند — تأكيد الحجز ${args.reference}`,
      text,
      html,
      tag: 'booking-confirmation',
    };
  }

  const text = [
    `Hi ${args.name},`,
    ``,
    `We're delighted to confirm your Crown Island booking. ✅`,
    ``,
    `Booking details:`,
    `Reference: ${args.reference}`,
    `Service: ${args.serviceName}`,
    `Date: ${args.dateLabel}`,
    `Guests: ${args.peopleLabel}`,
    `Total paid: ${args.totalLabel}`,
    ``,
    `View your booking and entry QR code here:`,
    args.manageUrl,
    ``,
    `We look forward to welcoming you. Please bring your QR code and a valid ID`,
    `for each guest to present at the gate.`,
    ``,
    brandFooter(year),
  ].join('\n');
  const html = confirmationHtml({
    dir: 'ltr',
    title: 'Booking confirmed',
    greeting: `Dear ${args.name},`,
    intro:
      "We're delighted to confirm your reservation at Crown Island. Here are your booking details:",
    rows: [
      { label: 'Reference', value: args.reference, ltrValue: true },
      { label: 'Service', value: args.serviceName },
      { label: 'Date', value: args.dateLabel },
      { label: 'Guests', value: args.peopleLabel },
      { label: 'Total paid', value: args.totalLabel, emphasize: true },
    ],
    ctaLabel: 'View booking & entry QR',
    ctaUrl: args.manageUrl,
    closing:
      'We look forward to welcoming you. Please present your QR code and a valid ID for each guest at the gate.',
    footerLines: ['Crown Island · El Montazah', `© ${year} — all rights reserved`],
    preheader: `Your Crown Island booking is confirmed — ${args.reference}`,
  });
  return {
    to: args.to,
    subject: `Crown Island — booking confirmed ${args.reference}`,
    text,
    html,
    tag: 'booking-confirmation',
  };
}

export interface RefundNoticeArgs {
  to: string;
  name: string;
  locale: 'ar' | 'en';
  reference: string;
  /** Pre-formatted, locale-aware refunded amount. */
  amountLabel: string;
  manageUrl: string;
}

/** Refund processed — booking cancelled and money returned. */
export function refundNoticeTemplate(args: RefundNoticeArgs): EmailMessage {
  const year = new Date().getFullYear();

  if (args.locale === 'ar') {
    const text = [
      `مرحباً ${args.name}،`,
      ``,
      `تمت معالجة استرداد مبلغ حجزك في كراون آيلاند.`,
      ``,
      `رقم الحجز: ${args.reference}`,
      `المبلغ المسترد: ${args.amountLabel}`,
      ``,
      `تم إلغاء الحجز. قد يستغرق ظهور المبلغ في حسابك حتى ١٤ يوم عمل حسب البنك.`,
      ``,
      `تفاصيل الحجز:`,
      args.manageUrl,
      ``,
      brandFooterAr(year),
    ].join('\n');
    return { to: args.to, subject: `كراون آيلاند — استرداد مبلغ الحجز ${args.reference}`, text, tag: 'refund-notice' };
  }

  const text = [
    `Hi ${args.name},`,
    ``,
    `A refund for your Crown Island booking has been processed.`,
    ``,
    `Reference: ${args.reference}`,
    `Amount refunded: ${args.amountLabel}`,
    ``,
    `The booking has been cancelled. Depending on your bank, the amount may take`,
    `up to 14 business days to appear on your statement.`,
    ``,
    `Booking details:`,
    args.manageUrl,
    ``,
    brandFooter(year),
  ].join('\n');
  return { to: args.to, subject: `Crown Island — refund processed ${args.reference}`, text, tag: 'refund-notice' };
}

export function verifyEmailTemplate(args: {
  to: string;
  link: string;
  expiresInMinutes: number;
  /** Email-body language. Defaults to English when omitted. */
  locale?: 'ar' | 'en';
}): EmailMessage {
  const year = new Date().getFullYear();

  if (args.locale === 'ar') {
    const text = [
      `مرحباً بك في كراون آيلاند.`,
      ``,
      `لإتمام إنشاء حسابك، يرجى تأكيد بريدك الإلكتروني بالضغط على الرابط الآمن أدناه.`,
      `تنتهي صلاحية الرابط خلال ${args.expiresInMinutes} دقيقة.`,
      ``,
      args.link,
      ``,
      `إذا لم تطلب هذا، يمكنك تجاهل هذه الرسالة بأمان — لن يتم إنشاء أي حساب.`,
      ``,
      brandFooterAr(year),
    ].join('\n');
    return { to: args.to, subject: 'كراون آيلاند — تأكيد بريدك الإلكتروني', text, tag: 'verify-email' };
  }

  const text = [
    `Welcome to Crown Island.`,
    ``,
    `To finish creating your account, confirm this is your email address by`,
    `clicking the secure link below. It expires in ${args.expiresInMinutes} minutes.`,
    ``,
    args.link,
    ``,
    `If you didn't request this, you can safely ignore this email — no account`,
    `will be created.`,
    ``,
    brandFooter(year),
  ].join('\n');

  return {
    to: args.to,
    subject: 'Crown Island — verify your email',
    text,
    tag: 'verify-email',
  };
}

export function passwordResetTemplate(args: {
  to: string;
  link: string;
  expiresInMinutes: number;
  /** Email-body language. Defaults to English when omitted. */
  locale?: 'ar' | 'en';
}): EmailMessage {
  const year = new Date().getFullYear();

  if (args.locale === 'ar') {
    const text = [
      `إعادة تعيين كلمة مرور كراون آيلاند.`,
      ``,
      `اضغط على الرابط الآمن أدناه لاختيار كلمة مرور جديدة.`,
      `تنتهي صلاحية الرابط خلال ${args.expiresInMinutes} دقيقة.`,
      ``,
      args.link,
      ``,
      `إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذه الرسالة بأمان.`,
      `لن تتغير كلمة مرورك الحالية.`,
      ``,
      brandFooterAr(year),
    ].join('\n');
    return { to: args.to, subject: 'كراون آيلاند — إعادة تعيين كلمة المرور', text, tag: 'reset-password' };
  }

  const text = [
    `Reset your Crown Island password.`,
    ``,
    `Click the secure link below to choose a new password. It expires in`,
    `${args.expiresInMinutes} minutes.`,
    ``,
    args.link,
    ``,
    `If you didn't request a password reset, you can safely ignore this email.`,
    `Your current password won't change.`,
    ``,
    brandFooter(year),
  ].join('\n');

  return {
    to: args.to,
    subject: 'Crown Island — reset your password',
    text,
    tag: 'reset-password',
  };
}
