'use client';

import { code128Svg } from '@/lib/code128';

/**
 * Print the ticket as small, bracelet-sized Code 128 barcode stickers — one per
 * guest.
 *
 * The barcode encodes the booking **reference** (e.g. `CI-20260525-LM8T3J`),
 * not the long signed token. A reference is short (~18 chars), so the barcode
 * stays compact enough (~64 × 15 mm) to print as a sticker and wrap onto a
 * wristband while remaining reliably scannable. The gate scanner resolves the
 * reference against the database (status / date / already-used are all checked
 * server-side), and the human-readable reference is printed beneath each
 * barcode for manual fallback. The guest's QR still carries the full signed
 * token — this only changes the gate-printed bracelet sticker.
 */
export async function printTicketBarcode(opts: {
  /** Number of guests on the ticket → number of sticker copies to print. */
  count: number;
  /** Booking reference — the value encoded in the barcode. */
  invoice: string;
  customer: string;
}): Promise<void> {
  const { invoice, customer } = opts;
  const count = Math.max(1, Math.floor(opts.count) || 1);

  // The reference is what the barcode carries; nothing to print without it.
  if (!invoice || invoice === '—') return;

  let barcodeSvg: string;
  try {
    barcodeSvg = code128Svg(invoice, {
      moduleWidth: 2,
      height: 60,
      quiet: 10,
      dark: '#0a132a',
      light: '#ffffff',
    });
  } catch {
    return;
  }

  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;

  const cards = Array.from({ length: count })
    .map(
      (_, i) => `
      <div class="bar">
        <div class="code">${barcodeSvg}</div>
        <div class="ref" dir="ltr">${escapeHtml(invoice)}</div>
        <div class="idx">${i + 1} / ${count}</div>
      </div>`,
    )
    .join('');

  win.document.write(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Crown Island · ${escapeHtml(invoice)}</title>
<style>
  @page { margin: 8mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Manrope", system-ui, -apple-system, sans-serif;
    color: #0a132a;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .head { text-align: center; margin: 0 0 10px; }
  .head .brand { font-size: 14px; font-weight: 700; letter-spacing: 1px; }
  .head .sub { font-size: 10px; color: #555; margin-top: 3px; }
  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6mm 5mm;
    justify-content: flex-start;
    align-content: flex-start;
  }
  /* Each sticker is a compact bracelet label — ~70mm wide overall so it wraps
     around a wristband; the barcode itself is ~64 x 15mm. */
  .bar {
    width: 70mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    border: 1px solid #d8d8d8;
    border-radius: 6px;
    padding: 4px 4px 3px;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .code { width: 64mm; }
  .code svg { width: 64mm; height: 15mm; display: block; }
  .ref {
    margin-top: 2px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1px;
  }
  .idx { font-size: 7px; color: #888; margin-top: 1px; }
</style>
</head>
<body>
  <div class="head">
    <div class="brand">CROWN ISLAND</div>
    <div class="sub">${escapeHtml(customer)} · ${escapeHtml(invoice)} · ${count} ${
      count === 1 ? 'guest' : 'guests'
    }</div>
  </div>
  <div class="grid">${cards}</div>
  <script>
    window.onload = function () {
      window.focus();
      window.print();
    };
    window.onafterprint = function () { window.close(); };
  </script>
</body>
</html>`);
  win.document.close();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
