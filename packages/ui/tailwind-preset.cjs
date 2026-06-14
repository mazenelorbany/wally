// =============================================================================
// @wally/ui — Tailwind preset (the Wally design language).
//
// Consume from apps/web's tailwind config:
//
//   // tailwind.config.cjs
//   module.exports = {
//     presets: [require('@wally/ui/tailwind-preset.cjs')],
//     content: [
//       './src/**/*.{ts,tsx}',
//       './node_modules/@wally/ui/dist/**/*.js',
//     ],
//   };
//
// Colours resolve through CSS custom properties (defined in @wally/ui/styles.css)
// so a single import themes the whole app, while the hex defaults below keep the
// preset usable even before the stylesheet loads. Cool monochrome canvas
// (Stripe-style light), deep cool chrome rails (Linear-style dark), ONE brand
// red; pass/warn hues are reinforcement only (always paired with icon + label).
// =============================================================================

/** @param {string} varName @param {string} fallback */
const v = (varName, fallback) => `var(${varName}, ${fallback})`;

/** A named colour with a DEFAULT so `bg-x`, `bg-x/10`, `text-x` and
 *  `theme(colors.x.DEFAULT)` all resolve. */
const tone = (varName, fallback) => ({ DEFAULT: v(varName, fallback) });

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        // Cool monochrome scale (the data canvas).
        paper: tone("--wally-paper", "#FCFCFD"),
        surface: tone("--wally-surface", "#F4F5F8"),
        ink: tone("--wally-ink", "#14171F"),
        graphite: tone("--wally-graphite", "#3E4654"),
        steel: tone("--wally-steel", "#686F83"),
        mist: tone("--wally-mist", "#D9DCE3"),

        // Brand RED accent — Cuisine::pro red. `gold` for fills/borders/active
        // marks; `gold-bright` for glow on chrome; `gold-deep` for accent text
        // on light that must stay legible. (Token name kept `gold` so the
        // re-theme was a value-only swap; the hue is the brand red.)
        gold: {
          DEFAULT: v("--wally-gold", "#9A0000"),
          bright: v("--wally-gold-bright", "#C21A1A"),
          deep: v("--wally-gold-deep", "#7A0000"),
        },

        // Deep cool CHROME (sidebars / login / brand surfaces).
        chrome: {
          DEFAULT: v("--wally-chrome", "#101216"),
          raised: v("--wally-chrome-raised", "#1A1D24"),
          line: v("--wally-chrome-line", "#272C37"),
          ink: v("--wally-chrome-ink", "#EDEFF3"),
          muted: v("--wally-chrome-muted", "#8B93A6"),
        },

        // The "stop" accent.
        signal: tone("--wally-signal", "#C92C26"),

        // Reinforcement hues — never used hue-alone in components.
        pass: tone("--wally-pass", "#148052"),
        warn: tone("--wally-warn", "#5B6B83"),

        // Semantic aliases so component classes read intent, not raw tone.
        background: tone("--wally-paper", "#FCFCFD"),
        foreground: tone("--wally-ink", "#14171F"),
        muted: { DEFAULT: v("--wally-surface", "#F4F5F8"), foreground: v("--wally-steel", "#686F83") },
        border: tone("--wally-mist", "#D9DCE3"),
        ring: tone("--wally-ink", "#14171F"),
      },

      fontFamily: {
        // Inter everywhere — headings differ by weight + tracking, not face.
        display: [
          v("--wally-font-display", '"Inter"'),
          "system-ui",
          "-apple-system",
          '"Segoe UI"',
          "sans-serif",
        ],
        sans: [
          v("--wally-font-sans", '"Inter"'),
          "system-ui",
          "-apple-system",
          '"Segoe UI"',
          "sans-serif",
        ],
      },

      borderRadius: {
        sm: "0.375rem",
        md: "0.5rem",
        lg: "0.625rem",
      },

      letterSpacing: {
        // Wordmarks / eyebrows breathe.
        brand: "0.14em",
      },

      transitionTimingFunction: {
        standard: v("--wally-ease-standard", "cubic-bezier(0.4, 0, 0.2, 1)"),
        out: v("--wally-ease-out", "cubic-bezier(0.16, 1, 0.3, 1)"),
        in: v("--wally-ease-in", "cubic-bezier(0.4, 0, 1, 1)"),
        spring: v("--wally-ease-spring", "cubic-bezier(0.34, 1.56, 0.64, 1)"),
      },

      transitionDuration: {
        fast: "120ms",
        base: "180ms",
        slow: "280ms",
      },

      keyframes: {
        "wally-spin": {
          to: { transform: "rotate(360deg)" },
        },
        "wally-overlay-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "wally-content-in": {
          from: { opacity: "0", transform: "translate(-50%, -48%) scale(0.97)" },
          to: { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
        },
        "wally-fade-in": {
          from: { opacity: "0", transform: "translateY(2px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },

      animation: {
        "wally-spin": "wally-spin 0.7s linear infinite",
        "wally-overlay-in": "wally-overlay-in 180ms cubic-bezier(0.16, 1, 0.3, 1)",
        "wally-content-in": "wally-content-in 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        "wally-fade-in": "wally-fade-in 160ms cubic-bezier(0.16, 1, 0.3, 1)",
      },

      boxShadow: {
        // Layered, low elevation — crisp hairline ring + soft drop (Stripe).
        card: "0 0 0 1px rgba(20, 23, 31, 0.04), 0 1px 1px rgba(20, 23, 31, 0.03), 0 1px 3px rgba(20, 23, 31, 0.05)",
        raised:
          "0 0 0 1px rgba(20, 23, 31, 0.04), 0 4px 8px -2px rgba(20, 23, 31, 0.06), 0 12px 20px -8px rgba(20, 23, 31, 0.10)",
        lift: "0 0 0 1px rgba(20, 23, 31, 0.05), 0 8px 16px -6px rgba(20, 23, 31, 0.10), 0 24px 48px -16px rgba(20, 23, 31, 0.18)",
        // Soft red halo for the brand mark + key active/primary affordances.
        glow: "0 0 0 1px rgba(154, 0, 0, 0.32), 0 8px 24px -10px rgba(154, 0, 0, 0.42)",
      },
    },
  },
};
