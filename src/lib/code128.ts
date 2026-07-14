/**
 * Dependency-free Code 128 (subset B) encoder.
 *
 * The gate prints the booking's signed token as a Code 128 barcode instead of a
 * QR code. The token is `base64url(payload).base64url(signature)` — its alphabet
 * is `A–Z a–z 0–9 - _ .`, all of which live in the Code 128 subset-B range
 * (ASCII 32–126), so the *exact* token is encoded with no transformation. The
 * scanner decodes it straight back to the same string the QR used to carry.
 *
 * This module is intentionally framework-free (no DOM, no Node APIs) so it runs
 * both in the browser print path and in the round-trip verification test.
 */

// Standard Code 128 module-width patterns for symbol values 0..106. Each entry
// is the bar/space width run starting with a bar; the final entry (STOP, 106)
// carries the 13-module terminator bar.
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

/**
 * Encode `data` as a Code 128-B module pattern.
 *
 * @returns an array of booleans — `true` is a dark module (bar), `false` a light
 * module (space) — covering the start symbol through the stop terminator. The
 * required quiet zones are *not* included; the renderer adds them.
 */
export function encodeCode128(data: string): boolean[] {
  const codes: number[] = [START_B];

  for (let i = 0; i < data.length; i++) {
    const value = data.charCodeAt(i) - 32;
    if (value < 0 || value > 94) {
      throw new Error(`Code 128-B cannot encode character code ${data.charCodeAt(i)} at index ${i}`);
    }
    codes.push(value);
  }

  // Modulo-103 checksum: start value (weight 1) plus each data value × position.
  let checksum = START_B;
  for (let i = 1; i < codes.length; i++) checksum += codes[i]! * i;
  codes.push(checksum % 103);
  codes.push(STOP);

  const modules: boolean[] = [];
  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code]!;
    let bar = true;
    for (let k = 0; k < pattern.length; k++) {
      const width = pattern.charCodeAt(k) - 48;
      for (let m = 0; m < width; m++) modules.push(bar);
      bar = !bar;
    }
  }
  return modules;
}

export interface Code128SvgOptions {
  /** Width of a single module in user units. Default 2. */
  moduleWidth?: number;
  /** Barcode height in user units. Default 80. */
  height?: number;
  /** Quiet-zone width on each side, in modules. Default 10 (spec minimum). */
  quiet?: number;
  /** Bar colour. Default Crown navy. */
  dark?: string;
  /** Background colour. Default white. */
  light?: string;
}

/**
 * Render `data` to a standalone Code 128 SVG string. The SVG carries a viewBox
 * so it scales cleanly to any print width while staying crisp.
 */
export function code128Svg(data: string, options: Code128SvgOptions = {}): string {
  const moduleWidth = options.moduleWidth ?? 2;
  const height = options.height ?? 80;
  const quiet = options.quiet ?? 10;
  const dark = options.dark ?? '#0a132a';
  const light = options.light ?? '#ffffff';

  const modules = encodeCode128(data);
  const totalModules = modules.length + quiet * 2;
  const width = totalModules * moduleWidth;

  let rects = '';
  let i = 0;
  while (i < modules.length) {
    if (!modules[i]) {
      i++;
      continue;
    }
    let run = 1;
    while (i + run < modules.length && modules[i + run]) run++;
    const x = (quiet + i) * moduleWidth;
    rects += `<rect x="${x}" y="0" width="${run * moduleWidth}" height="${height}"/>`;
    i += run;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges" preserveAspectRatio="none">` +
    `<rect width="${width}" height="${height}" fill="${light}"/>` +
    `<g fill="${dark}">${rects}</g></svg>`
  );
}
