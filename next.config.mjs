/** @type {import('next').NextConfig} */
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const isProd = process.env.NODE_ENV === 'production';

// Canonical production host derived from NEXT_PUBLIC_APP_URL (e.g. "crown-island.com").
// In production this is the ONLY extra Server-Action origin we allow; if it's
// unset we fall back to same-origin only (an empty allow-list), never a wildcard.
const prodAppHost = (() => {
  try {
    return process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL).host : null;
  } catch {
    return null;
  }
})();

// Shared tunnel hosts — DEVELOPMENT ONLY. These are shared registrable domains
// (anyone can claim a sibling subdomain), so they must never be trusted as
// Server-Action origins in production.
const DEV_TUNNEL_ORIGINS = [
  'localhost:3000',
  'anna-types-instances-pci.trycloudflare.com',
  '*.ngrok-free.app',
  '*.ngrok-free.dev',
  '*.ngrok.io',
  '*.ngrok.app',
  '*.ngrok.dev',
  '*.trycloudflare.com',
  '*.loca.lt',
];

const nextConfig = {
  reactStrictMode: true,
  // Origins allowed to reach the dev server's internal endpoints (HMR, RSC,
  // server actions) when the app is opened from a tunnel instead of localhost.
  // Wildcards cover any tunnel subdomain; the explicit host is listed too so the
  // current tunnel domain matches even if a Next release narrows wildcard support.
  allowedDevOrigins: [
    'anna-types-instances-pci.trycloudflare.com',
    '*.ngrok-free.app',
    '*.ngrok-free.dev',
    '*.ngrok.io',
    '*.ngrok.app',
    '*.ngrok.dev',
    '*.trycloudflare.com',
    '*.loca.lt',
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
      // Server Actions reject POSTs whose Origin isn't allow-listed (CSRF
      // defence). Same-origin is always allowed; this list adds EXTRA origins.
      //  - Production: ONLY the canonical NEXT_PUBLIC_APP_URL host (or nothing →
      //    same-origin only). No shared wildcard tunnel domains, so an attacker
      //    who owns a sibling tunnel subdomain can't forge Server-Action POSTs.
      //  - Development: the full tunnel list, so forms work from the dev tunnel.
      allowedOrigins: isProd ? [prodAppHost].filter(Boolean) : DEV_TUNNEL_ORIGINS,
    },
  },
  images: {
    // Accept any https image source. The app stores user-supplied URLs (Google
    // thumbnails, Unsplash, Cloudinary, etc), so an allow-list adds friction
    // without meaningful security — next/image already rewrites and re-serves
    // every remote asset through our own optimizer endpoint.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  async headers() {
    // HSTS is applied ONLY on the public HTTPS "online" node. The on-prem "local"
    // venue node is served over plain HTTP on the LAN, so forcing HTTPS would
    // brick it. APP_MODE is baked per-node at build time (each node runs its own
    // `next build`); anything other than an explicit "online" omits HSTS — the
    // safe direction (a missing header beats an un-removable HTTPS lock).
    const isOnlineNode = process.env.APP_MODE === 'online';

    // SEC-002: an application-wide Content-Security-Policy (there was none — only
    // /uploads had one). This is the containment baseline:
    //   - object-src 'none' + base-uri 'self' + form-action 'self' + frame-ancestors
    //     'self' shut down plugin abuse, <base> injection, form hijacking and
    //     cross-origin clickjacking.
    //   - frame-src/child 'self' keeps the (same-origin) MPGS payment frame working;
    //     the provider script itself loads INSIDE that frame's own document.
    //   - img/media allow https: because admins may set external cover/video URLs
    //     (kept in sync with images.remotePatterns).
    //   - script/style still allow 'unsafe-inline' (Next's inline bootstrap + the
    //     pre-paint theme script). Tightening to per-request nonces is a tracked
    //     follow-up; even so, the non-script directives above are a real gain.
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "img-src 'self' https: data: blob:",
      "media-src 'self' https: data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
      "connect-src 'self' https: wss:",
      "worker-src 'self' blob:",
      // frame-src: 'self' for the same-origin MPGS payment frame; the video-embed
      // hosts for admin-set category/about hero embeds (ExperienceVideo).
      "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
      "manifest-src 'self'",
    ].join('; ');

    // The MPGS payment IFRAME (/api/credit-agricole/frame) loads the EXTERNAL
    // Mastercard Hosted Checkout script (checkout.min.js), opens the gateway's card
    // iframe + an arbitrary-bank 3-D Secure ACS frame, and POSTs the card form to
    // the gateway. The tight global CSP above (script-src/frame-src/form-action
    // 'self') would block all three — taking card payments 100% down. This
    // frame-scoped policy relaxes ONLY that isolated route to `https:` (the gateway
    // host is a runtime env, not available here); every other route keeps the tight
    // global CSP. Per-key last-wins, exactly like the X-Frame-Options override below.
    // Deliberately PERMISSIVE for the trusted gateway: the MPGS checkout + 3-D-Secure
    // step spawns web workers (often blob:), may open WebSockets, injects nested ACS
    // (bank) frames, and POSTs to the gateway. At the last known-good state this route
    // had NO CSP at all, so anything tighter than "let the gateway work" risks a
    // silent auth failure ("transaction unsuccessful"). Isolation is preserved by
    // frame-ancestors 'self' (nobody else may embed our payment frame) + object-src
    // 'none'; card data never touches our origin regardless.
    const paymentFrameCsp = [
      "default-src 'self' https: data: blob:",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:",
      "style-src 'self' 'unsafe-inline' https:",
      "img-src 'self' https: data: blob:",
      "font-src 'self' https: data:",
      "connect-src 'self' https: wss:",
      "frame-src 'self' https:",
      "child-src 'self' https: blob:",
      "worker-src 'self' https: blob:",
      "form-action 'self' https:",
    ].join('; ');

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
          { key: 'Content-Security-Policy', value: csp },
          ...(isOnlineNode
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
            : []),
        ],
      },
      // The isolated MPGS payment iframe is embedded same-origin by the booking
      // payment page, so it must be framable (overrides the global DENY above).
      {
        source: '/api/credit-agricole/frame',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: paymentFrameCsp },
          // The gateway's embedded card form + 3-D-Secure need the `payment` and
          // WebAuthn features (and must delegate them to the nested cross-origin
          // gateway/ACS frames). The tight global Permissions-Policy (camera/mic
          // off) has no payment value here and could suppress a 3DS feature, so
          // this isolated route allows them — matching the header-less state in
          // which the gateway was tested working.
          {
            key: 'Permissions-Policy',
            value: 'payment=*, publickey-credentials-get=*, otp-credentials=*',
          },
        ],
      },
      // User-uploaded files are served as same-origin static assets from
      // public/uploads. A directly-opened upload (e.g. /uploads/2026/06/x.svg —
      // dotted paths bypass the proxy matcher) renders as its own document, so a
      // malicious SVG could otherwise execute inline <script> in our origin.
      // This CSP sandboxes any directly-served upload (no scripts/objects/forms);
      // raster images still display, and <img>/next-image embedding elsewhere is
      // unaffected (a subresource load isn't governed by this response's CSP).
      {
        source: '/uploads/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          },
        ],
      },
      // Gate scanner needs the rear camera for QR decoding. These rules come
      // after the global one so the camera directive overrides it for /gate.
      {
        source: '/gate/:path*',
        headers: [
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
        ],
      },
      {
        source: '/:locale/gate/:path*',
        headers: [
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
