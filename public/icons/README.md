# PWA icons

Replace the placeholder SVG with proper raster PNGs before production:

- `icon-192.png` — 192×192, maskable
- `icon-512.png` — 512×512, maskable

For now the manifest references PNG paths but they're not yet exported.
A temporary SVG fallback is used by the `<link rel="icon">` in the root layout.
