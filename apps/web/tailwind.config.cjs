// =============================================================================
// Tailwind config — @wally/web.
//
// The canonical Wally design scale lives in @wally/ui's tailwind preset. We
// pull it in via `presets` so colours/fonts/radii stay in one place across
// surfaces. The preset is loaded defensively: in a fresh checkout where
// @wally/ui hasn't been built yet, we fall back to an inline copy of the same
// tokens so the web app still compiles and renders on-brand standalone. Once
// the package is present the preset wins (single source of truth).
// =============================================================================

/** @type {import('tailwindcss').Config['theme']} */
const wallyTheme = {
  extend: {
    colors: {
      // Cool monochrome
      paper: '#FCFCFD',
      surface: '#F4F5F8',
      ink: '#14171F',
      graphite: '#3E4654',
      steel: '#686F83',
      mist: '#D9DCE3',
      // One stop red + verdict accents
      signal: '#C92C26',
      pass: '#148052',
      warn: '#5B6B83',
      // Semantic aliases (so utility names read intent, not hue)
      verdict: {
        perfect: '#148052',
        good: '#3E4654',
        notgood: '#C92C26',
        review: '#5B6B83',
        missing: '#686F83',
      },
    },
    fontFamily: {
      // Inter everywhere — Linear/Stripe lineage.
      sans: [
        'Inter',
        'system-ui',
        '-apple-system',
        'Segoe UI',
        'sans-serif',
      ],
      display: ['Inter', 'system-ui', 'sans-serif'],
    },
    borderRadius: {
      xl: '0.875rem',
      '2xl': '1.25rem',
    },
    boxShadow: {
      card: '0 0 0 1px rgba(20,23,31,0.04), 0 1px 1px rgba(20,23,31,0.03), 0 1px 3px rgba(20,23,31,0.05)',
      lift: '0 0 0 1px rgba(20,23,31,0.05), 0 8px 16px -6px rgba(20,23,31,0.10), 0 24px 48px -16px rgba(20,23,31,0.18)',
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
  theme: presets.length > 0 ? {} : wallyTheme,
};
