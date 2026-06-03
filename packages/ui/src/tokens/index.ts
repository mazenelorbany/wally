// =============================================================================
// Design tokens — re-exports for the colour palette + verdict maps, plus the
// non-colour scales (type, radius, motion) the components reference. Pure
// runtime-free data; safe to import from anywhere.
// =============================================================================

export {
  palette,
  verdictMeta,
  criterionMeta,
  type PaletteToken,
  type VerdictMeta,
  type VerdictKey,
  type VerdictIconName,
} from "./colors";

/** Geometric font stack — Century Gothic first, Questrial as the loaded web
 *  fallback, Futura + generic geometrics behind it. Mirrored in styles.css as
 *  `--font-display` / `--font-sans` and in the Tailwind preset. */
export const fontStack = {
  display:
    '"Century Gothic", "Questrial", "Futura", "Avenir Next", "Avenir", system-ui, sans-serif',
  sans: '"Questrial", "Century Gothic", "Futura", system-ui, -apple-system, "Segoe UI", sans-serif',
} as const;

/** Corner radii. Calm + editorial: small, consistent. */
export const radius = {
  sm: "0.25rem",
  md: "0.5rem",
  lg: "0.75rem",
  pill: "9999px",
} as const;

/** Custom easing curves — premium, slightly weighted exits. Mirrored as
 *  `--ease-*` custom properties in styles.css and the preset. */
export const easing = {
  /** Standard in/out for most transitions. */
  standard: "cubic-bezier(0.4, 0, 0.2, 1)",
  /** Entrances — decelerate. */
  out: "cubic-bezier(0.16, 1, 0.3, 1)",
  /** Exits — accelerate. */
  in: "cubic-bezier(0.4, 0, 1, 1)",
  /** A touch of overshoot for emphasis (chips, confirmations). */
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;

export const duration = {
  fast: "120ms",
  base: "180ms",
  slow: "280ms",
} as const;
