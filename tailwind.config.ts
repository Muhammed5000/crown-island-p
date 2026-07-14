import type { Config } from 'tailwindcss';

/**
 * Crown Island design tokens — sourced from the Claude Design handoff
 * (`docs/reference/`). The palette is dark navy + warm gold + cream text;
 * CSS variables expose the same tokens for runtime theme switching.
 */
const config: Config = {
  darkMode: ['class'],
  content: [
    './src/app/**/*.{ts,tsx,mdx}',
    './src/components/**/*.{ts,tsx,mdx}',
    './src/features/**/*.{ts,tsx,mdx}',
  ],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: '1rem',
        sm: '1.25rem',
        md: '1.5rem',
        lg: '2rem',
      },
      screens: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1200px',
      },
    },
    extend: {
      /**
       * Body text is enlarged to 125% of the stock Tailwind sizes (non-header).
       * Only the body-range steps (xs–lg) are scaled; the larger header steps
       * (xl and up) keep Tailwind's defaults so headings are untouched. Original
       * line-heights are preserved to limit vertical-overflow on tight layouts.
       */
      fontSize: {
        xs: ['0.9375rem', { lineHeight: '1rem' }],
        sm: ['1.09375rem', { lineHeight: '1.25rem' }],
        base: ['1.25rem', { lineHeight: '1.5rem' }],
        lg: ['1.40625rem', { lineHeight: '1.75rem' }],
      },
      fontFamily: {
        // Tajawal leads every UI stack so all Arabic (and Latin) UI text renders
        // in it; the named Arabic faces are graceful fallbacks if it ever fails.
        sans: ['var(--font-arabic)', 'IBM Plex Sans Arabic', 'Almarai', 'DIN Next Arabic', 'system-ui', 'sans-serif'],
        arabic: ['var(--font-arabic)', 'IBM Plex Sans Arabic', 'Almarai', 'DIN Next Arabic', 'system-ui', 'sans-serif'],
        // Latin display headings use Playfair; Arabic glyphs (absent from it)
        // fall through to Tajawal so headings never drop to a system serif.
        display: ['var(--font-display)', 'Playfair Display', 'var(--font-arabic)', 'Georgia', 'serif'],
        // AURELIA — used only inside the redesigned booking screens.
        // Latin glyphs render in Cormorant/Manrope; Arabic glyphs (which those
        // Latin faces don't contain) fall through to Tajawal — the loaded
        // Arabic webfont — so headings/body show a clean Arabic sans matching
        // the reference image, never a system serif fallback.
        'aurelia-display': ['var(--font-aurelia-display)', 'Cormorant Garamond', 'var(--font-arabic)', 'Georgia', 'serif'],
        'aurelia-sans': ['var(--font-aurelia-sans)', 'Manrope', 'var(--font-arabic)', 'system-ui', 'sans-serif'],
      },
      colors: {
        background: 'rgb(var(--ci-background) / <alpha-value>)',
        foreground: 'rgb(var(--ci-foreground) / <alpha-value>)',
        muted: {
          DEFAULT: 'rgb(var(--ci-muted) / <alpha-value>)',
          foreground: 'rgb(var(--ci-muted-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'rgb(var(--ci-card) / <alpha-value>)',
          foreground: 'rgb(var(--ci-card-foreground) / <alpha-value>)',
        },
        border: 'rgb(var(--ci-border) / <alpha-value>)',
        input: 'rgb(var(--ci-input) / <alpha-value>)',
        ring: 'rgb(var(--ci-ring) / <alpha-value>)',
        /** Navy — primary actions/headings (image's "احجز الآن" pills). */
        primary: {
          DEFAULT: 'rgb(var(--ci-primary) / <alpha-value>)',
          foreground: 'rgb(var(--ci-primary-foreground) / <alpha-value>)',
        },
        /** Turquoise — active states, links, focus, the round activity buttons. */
        accent: {
          DEFAULT: 'rgb(var(--ci-accent) / <alpha-value>)',
          foreground: 'rgb(var(--ci-accent-foreground) / <alpha-value>)',
        },
        /**
         * Navy palette — the 950 deepest end matches `bgDeep` (#091322) from
         * the design source, and 900 is the page bg `#0d1a2b`.
         */
        navy: {
          50: '#e9edf3',
          100: '#c5cddd',
          200: '#9eabc4',
          300: '#7689a8',
          400: '#566c92',
          500: '#39527c',
          600: '#2a3f62',
          700: '#1a2c42', // cardAlt
          800: '#142436', // card
          900: '#0d1a2b', // bg
          950: '#091322', // bgDeep
        },
        /**
         * Gold palette tuned to the design's `#d4a557` (mid) / `#b88a3a`
         * (dark) / `#e8c47f` (light).
         */
        gold: {
          50: '#faf5e6',
          100: '#f1e6c4',
          200: '#e6d39a',
          300: '#d8be7e', // goldLight
          400: '#c2a14e', // gold (primary highlight — from the reference)
          500: '#b08f3f',
          600: '#9c7d34', // goldDark
          700: '#7c6228',
          800: '#54431b',
          900: '#2e250f',
        },
        /** Turquoise/teal scale — the reference's accent (500 = accent token). */
        teal: {
          50: '#e7f5f6',
          100: '#c5e8ea',
          200: '#9bd7da',
          300: '#6fc3c8',
          400: '#45acb3',
          500: '#2a9da8',
          600: '#218c95',
          700: '#1b727a',
          800: '#175a60',
          900: '#123f44',
        },
        /** Warm cream/sand text colour used throughout the design. */
        cream: '#f3ecdc',
        /**
         * AURELIA palette — used by the redesigned `/booking` page. Kept
         * separate from the navy/gold tokens above so the rest of the app
         * isn't accidentally re-coloured.
         */
        aurelia: {
          bg: '#0a0f16',
          'bg-2': '#0e1622',
          ink: '#0e1622',
          cream: '#f5ead0',
          gold: '#e3bf73',
          'gold-soft': 'rgba(227,191,115,0.12)',
          'gold-line': 'rgba(227,191,115,0.4)',
          'cream-mute': 'rgba(245,234,208,0.55)',
          'cream-dim': 'rgba(245,234,208,0.7)',
        },
        success: '#3ea968',
        warning: '#f59e0b',
        danger: '#dc2626',
        info: '#0ea5e9',
      },
      borderRadius: {
        lg: '0.625rem',
        xl: '0.75rem',
        '2xl': '0.875rem',
        '3xl': '1rem',
      },
      boxShadow: {
        gold: '0 10px 26px -12px rgba(194, 161, 78, 0.40)',
        glow: '0 0 28px -10px rgba(42, 157, 168, 0.35)',
        navy: '0 12px 28px -12px rgba(22, 48, 79, 0.35)',
        teal: '0 12px 28px -12px rgba(42, 157, 168, 0.40)',
        // Soft, light, layered card shadows (theme-aware via CSS vars).
        card: 'var(--shadow-soft)',
        soft: 'var(--shadow-soft)',
        lift: 'var(--shadow-lift)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.22, 1, 0.36, 1)',
        soft: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.4s ease-out',
        shimmer: 'shimmer 2s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
