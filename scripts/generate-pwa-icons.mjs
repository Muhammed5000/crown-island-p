// Generates the PWA PNG icons Chromium requires for installability (the
// native install prompt won't fire on an SVG-only manifest). Rasterizes the
// brand wordmark `public/icons/icon.svg` centered on a branded navy square.
//
//   node scripts/generate-pwa-icons.mjs
//
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const SVG = readFileSync('public/icons/icon.svg');
const BG = { r: 10, g: 19, b: 42, alpha: 1 }; // #0A132A — manifest theme color

/** Render the logo at `widthRatio` of the tile, centered on a BG square. */
async function gen(size, widthRatio, out) {
  const logo = await sharp(SVG, { density: 512 })
    .resize({ width: Math.round(size * widthRatio) })
    .png()
    .toBuffer();
  const png = await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toBuffer();
  writeFileSync(out, png);
  console.log('wrote', out, png.length, 'bytes');
}

// "any" purpose — comfortable padding.
await gen(192, 0.78, 'public/icons/icon-192.png');
await gen(512, 0.78, 'public/icons/icon-512.png');
// "maskable" — keep the mark inside the central 80% safe zone (extra padding).
await gen(512, 0.58, 'public/icons/icon-maskable-512.png');
// Apple touch icon (iOS home-screen / "Add to Home Screen").
await gen(180, 0.74, 'public/icons/icon-apple-180.png');
