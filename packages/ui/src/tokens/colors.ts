// =============================================================================
// Wally colour tokens — the single source of truth for @wally/ui.
//
// The design language is a Linear × Stripe mix wearing the TCC accent: a cool
// near-white CANVAS with hairline borders and layered low shadows (Stripe),
// deep cool-dark CHROME for the rails (Linear), Inter type, and the
// Cuisine::pro RED as the single brand accent, with RED also meaning "stop".
//
// Colour is never load-bearing alone: every verdict also carries an icon + a
// text label (see `verdictMeta`). The GRB CEO is colour blind and sees red, so
// red means genuine "stop" and is always paired with the cross-circle icon +
// the word.
//
// These hexes are mirrored as CSS custom properties in ./../styles.css and as
// named Tailwind colours in ../../tailwind-preset.cjs. Keep all three in sync.
// =============================================================================

/** Raw brand hexes. Use the semantic Tailwind tokens in components; reach for
 *  these only when an inline style or canvas/SVG fill needs a literal value. */
export const palette = {
  /** Cool monochrome — lightest surface, the "page" + cards (the data canvas). */
  paper: "#FCFCFD",
  /** One step up from paper — muted fills, hover states, rails. */
  surface: "#F4F5F8",
  /** Near-black cool ink — primary text. */
  ink: "#14171F",
  /** Softer ink — secondary headings, strong body. */
  graphite: "#3E4654",
  /** Muted text — labels, captions, metadata. */
  steel: "#686F83",
  /** Hairlines, dividers, disabled strokes. */
  mist: "#D9DCE3",

  /** The brand RED — Cuisine::pro red. Active nav, brand mark, focus, CTAs.
   *  (Token name kept `gold` so the re-theme stays a value-only swap.) */
  gold: "#9A0000",
  /** Brighter red for accents/glow on the dark chrome. */
  goldBright: "#C21A1A",
  /** Deep red for accent-on-light text that must stay legible. */
  goldDeep: "#7A0000",

  /** Deep cool CHROME — the rails (sidebar / login / brand surfaces). */
  chrome: "#101216",
  /** Raised within chrome — hover / active row backgrounds. */
  chromeRaised: "#1A1D24",
  /** Hairlines / dividers on chrome. */
  chromeLine: "#272C37",
  /** Primary text on chrome — cool white. */
  chromeInk: "#EDEFF3",
  /** Muted text on chrome — labels, inactive nav. */
  chromeMuted: "#8B93A6",

  /** The "stop" accent — modern stop red. Critical / fail only. */
  signal: "#C92C26",

  /** Reinforcement hues — only ever shown alongside an icon + label. */
  pass: "#148052",
  warn: "#5B6B83",
} as const;

export type PaletteToken = keyof typeof palette;

/** Names of the lucide-react icons used by the verdict + status atoms. Kept as
 *  string keys so this module stays runtime-pure (no React import); the atoms
 *  resolve them to components. */
export type VerdictIconName =
  | "CheckCircle2"
  | "Check"
  | "XCircle"
  | "HelpCircle"
  | "CircleDashed";

/**
 * Verdict presentation map. Colour is *reinforcement only* — `icon` + `label`
 * carry the meaning so the UI is legible without hue (colour-blind safe).
 *
 * Keys are the `Overall` union from @wally/types plus the store-level
 * "incomplete" band, so a single map serves photo, fixture and store verdicts.
 */
export interface VerdictMeta {
  /** lucide-react icon name. */
  icon: VerdictIconName;
  /** Human label shown next to the icon — never rely on colour alone. */
  label: string;
  /** Tailwind classes (via the preset's named colours) for the chip. */
  className: string;
  /** Literal accent hex, for SVG/canvas/inline use. */
  hex: string;
}

export type VerdictKey =
  | "perfect"
  | "good"
  | "not_good"
  | "needs_review"
  | "incomplete";

export const verdictMeta: Record<VerdictKey, VerdictMeta> = {
  perfect: {
    icon: "CheckCircle2",
    label: "Perfect",
    className:
      "border-pass/35 bg-pass/10 text-pass [--verdict-accent:theme(colors.pass.DEFAULT)]",
    hex: palette.pass,
  },
  good: {
    icon: "Check",
    label: "Good",
    className:
      "border-graphite/25 bg-surface text-graphite [--verdict-accent:theme(colors.graphite.DEFAULT)]",
    hex: palette.graphite,
  },
  not_good: {
    icon: "XCircle",
    label: "Not good",
    className:
      "border-signal/40 bg-signal/10 text-signal [--verdict-accent:theme(colors.signal.DEFAULT)]",
    hex: palette.signal,
  },
  needs_review: {
    icon: "HelpCircle",
    label: "Needs review",
    className:
      "border-warn/40 bg-warn/10 text-warn [--verdict-accent:theme(colors.warn.DEFAULT)]",
    hex: palette.warn,
  },
  incomplete: {
    icon: "CircleDashed",
    label: "Incomplete",
    className:
      "border-mist bg-surface text-steel [--verdict-accent:theme(colors.steel.DEFAULT)]",
    hex: palette.steel,
  },
};

/** Per-criterion verdict ("pass" | "fail" | "unsure") presentation — same
 *  colour-blind-safe contract as the rollup verdicts. */
export const criterionMeta: Record<
  "pass" | "fail" | "unsure",
  VerdictMeta
> = {
  pass: {
    icon: "Check",
    label: "Pass",
    className: "border-pass/35 bg-pass/10 text-pass",
    hex: palette.pass,
  },
  fail: {
    icon: "XCircle",
    label: "Fail",
    className: "border-signal/40 bg-signal/10 text-signal",
    hex: palette.signal,
  },
  unsure: {
    icon: "HelpCircle",
    label: "Unsure",
    className: "border-warn/40 bg-warn/10 text-warn",
    hex: palette.warn,
  },
};
