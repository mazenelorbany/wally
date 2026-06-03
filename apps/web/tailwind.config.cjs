// =============================================================================
// Tailwind config — @wally/web.
//
// The canonical TCC brand scale lives in @wally/ui's tailwind preset. We pull
// it in via `presets` so colours/fonts/radii stay in one place across surfaces.
// The preset is loaded defensively: in a fresh checkout where @wally/ui hasn't
// been built yet, we fall back to an inline copy of the same tokens so the web
// app still compiles and renders on-brand standalone. Once the package is
// present the preset wins (single source of truth).
// =============================================================================

/** @type {import('tailwindcss').Config['theme']} */
const tccTheme = {
  extend: {
    colors: {
      // Warm monochrome
      paper: '#FBFBF9',
      surface: '#F3F2EE',
      ink: '#0E0E0D',
      graphite: '#3C3B36',
      steel: '#7E7D77',
      mist: '#BEBDB6',
      // One signal red + verdict accents
      signal: '#B23A2E',
      pass: '#3E7C5A',
      warn: '#C9892F',
      // Semantic aliases (so utility names read intent, not hue)
      verdict: {
        perfect: '#3E7C5A',
        good: '#5E7E6B',
        notgood: '#B23A2E',
        review: '#C9892F',
        missing: '#7E7D77',
      },
    },
    fontFamily: {
      // Geometric stack — Century Gothic falls back to Questrial / Futura.
      sans: [
        'Questrial',
        'Century Gothic',
        'Futura',
        'system-ui',
        '-apple-system',
        'Segoe UI',
        'sans-serif',
      ],
      display: ['Century Gothic', 'Questrial', 'Futura', 'system-ui', 'sans-serif'],
    },
    borderRadius: {
      xl: '0.875rem',
      '2xl': '1.25rem',
    },
    boxShadow: {
      card: '0 1px 2px rgba(14,14,13,0.04), 0 8px 24px -16px rgba(14,14,13,0.18)',
      lift: '0 2px 4px rgba(14,14,13,0.06), 0 18px 40px -22px rgba(14,14,13,0.28)',
    },
    transitionTimingFunction: {
      out: 'cubic-bezier(0.23, 1, 0.32, 1)',
      snap: 'cubic-bezier(0.34, 1.2, 0.64, 1)',
    },
    keyframes: {
      'fade-up': {
        from: { opacity: '0', transform: 'translateY(6px)' },
        to: { opacity: '1', transform: 'translateY(0)' },
      },
      'scale-in': {
        from: { opacity: '0', transform: 'scale(0.97)' },
        to: { opacity: '1', transform: 'scale(1)' },
      },
    },
    animation: {
      'fade-up': 'fade-up 240ms cubic-bezier(0.23, 1, 0.32, 1) both',
      'scale-in': 'scale-in 180ms cubic-bezier(0.23, 1, 0.32, 1) both',
    },
  },
};

let presets = [];
try {
  // Preferred: the shared brand preset from @wally/ui.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  presets = [require('@wally/ui/tailwind-preset.cjs')];
} catch {
  // @wally/ui not built yet — fall through to the inline theme below.
  presets = [];
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets,
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: presets.length > 0 ? {} : tccTheme,
};
