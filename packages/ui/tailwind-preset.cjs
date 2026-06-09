// =============================================================================
// @wally/ui — Tailwind preset (the TCC brand).
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
// preset usable even before the stylesheet loads. Warm monochrome + ONE signal
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
        // Warm monochrome scale (the data canvas).
        paper: tone("--wally-paper", "#FBFBF9"),
        surface: tone("--wally-surface", "#F3F2EE"),
        ink: tone("--wally-ink", "#0E0E0D"),
        graphite: tone("--wally-graphite", "#3C3B36"),
        steel: tone("--wally-steel", "#7E7D77"),
        mist: tone("--wally-mist", "#BEBDB6"),

        // Brand RED accent — Cuisine::pro red. `gold` for fills/borders/active
        // marks; `gold-bright` for glow on chrome; `gold-deep` for accent text
        // on light that must stay legible. (Token name kept `gold` so the
        // re-theme was a value-only swap; the hue is now the brand red.)
        gold: {
          DEFAULT: v("--wally-gold", "#9A0000"),
          bright: v("--wally-gold-bright", "#C21A1A"),
          deep: v("--wally-gold-deep", "#7A0000"),
        },

        // Premium dark CHROME (sidebars / login / brand surfaces).
        chrome: {
          DEFAULT: v("--wally-chrome", "#16140E"),
          raised: v("--wally-chrome-raised", "#221F16"),
          line: v("--wally-chrome-line", "#322E20"),
          ink: v("--wally-chrome-ink", "#F4F1E8"),
          muted: v("--wally-chrome-muted", "#9E998B"),
        },

        // The "stop" accent.
        signal: tone("--wally-signal", "#A6342A"),

        // Reinforcement hues — never used hue-alone in components.
        pass: tone("--wally-pass", "#3E7C5A"),
        warn: tone("--wally-warn", "#5B6B7A"),

        // Semantic aliases so component classes read intent, not raw tone.
        background: tone("--wally-paper", "#FBFBF9"),
        foreground: tone("--wally-ink", "#0E0E0D"),
        muted: { DEFAULT: v("--wally-surface", "#F3F2EE"), foreground: v("--wally-steel", "#7E7D77") },
        border: tone("--wally-mist", "#BEBDB6"),
        ring: tone("--wally-ink", "#0E0E0D"),
      },

      fontFamily: {
        // Century Gothic first, Questrial as the loaded fallback, then Futura.
        display: [
          v("--wally-font-display", '"Century Gothic"'),
          "Questrial",
          "Futura",
          "Avenir Next",
          "Avenir",
          "system-ui",
          "sans-serif",
        ],
        sans: [
          v("--wally-font-sans", '"Questrial"'),
          '"Century Gothic"',
          "Futura",
          "system-ui",
          "-apple-system",
          '"Segoe UI"',
          "sans-serif",
        ],
      },

      borderRadius: {
        sm: "0.25rem",
        md: "0.5rem",
        lg: "0.75rem",
      },

      letterSpacing: {
        // Geometric wordmarks breathe.
        brand: "0.18em",
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
        // Calm, low elevation — editorial, not glossy.
        card: "0 1px 2px rgba(14, 14, 13, 0.04), 0 1px 1px rgba(14, 14, 13, 0.03)",
        raised: "0 6px 24px -8px rgba(14, 14, 13, 0.18)",
        lift: "0 10px 30px -12px rgba(14, 14, 13, 0.22)",
        // Soft red halo for the brand mark + key active/primary affordances.
        glow: "0 0 0 1px rgba(154, 0, 0, 0.32), 0 8px 24px -10px rgba(154, 0, 0, 0.42)",
      },
    },
  },
};
