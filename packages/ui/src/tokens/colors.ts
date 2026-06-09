// =============================================================================
// TCC brand colour tokens — the single source of truth for @wally/ui.
//
// The Custom Chef™ brand: a warm near-black, polished steel greys, a premium
// GOLD accent (Black Samurai / Emperor / Kiyoshi gold; #FFCC00 on the live
// site), and a deep Japanese-steel RED. So the system is warm-monochrome paper
// → ink for the data CANVAS, premium dark CHROME for the rails, GOLD as the
// brand accent, and RED reserved for "stop".
//
// Colour is never load-bearing alone: every verdict also carries an icon + a
// text label (see `verdictMeta`). The GRB CEO is colour blind and sees red, so
// red means genuine "stop" and is always paired with the cross-circle icon +
// the word. Gold is colour-blind-safe (distinct from the red/green verdict
// hues) and so does the brand-accent work the lone red used to overreach into.
//
// These hexes are mirrored as CSS custom properties in ./../styles.css and as
// named Tailwind colours in ../../tailwind-preset.cjs. Keep all three in sync.
// =============================================================================

/** Raw brand hexes. Use the semantic Tailwind tokens in components; reach for
 *  these only when an inline style or canvas/SVG fill needs a literal value. */
export const palette = {
  /** Warm monochrome — lightest surface, the "page" (the data canvas). */
  paper: "#FBFBF9",
  /** One step up from paper — cards, rails, raised surfaces. */
  surface: "#F3F2EE",
  /** Near-black warm ink — primary text. */
  ink: "#0E0E0D",
  /** Softer ink — secondary headings, strong body. */
  graphite: "#3C3B36",
  /** Muted text — labels, captions, metadata. */
  steel: "#7E7D77",
  /** Hairlines, dividers, disabled strokes. */
  mist: "#BEBDB6",

  /** The premium brand TEAL/verdigris — active nav, brand mark, focus, CTAs.
   *  (Token name kept `gold` so the re-theme stays a value-only swap.) */
  gold: "#0E6E6E",
  /** Brighter teal for accents/glow on the dark chrome. */
  goldBright: "#1FA0A0",
  /** Deep teal for accent-on-light text that must stay legible. */
  goldDeep: "#0A4F50",

  /** Premium dark CHROME — the rails (sidebar / login / brand surfaces). */
  chrome: "#16140E",
  /** Raised within chrome — hover / active row backgrounds. */
  chromeRaised: "#221F16",
  /** Hairlines / dividers on chrome. */
  chromeLine: "#322E20",
  /** Primary text on chrome — warm cream. */
  chromeInk: "#F4F1E8",
  /** Muted text on chrome — labels, inactive nav. */
  chromeMuted: "#9E998B",

  /** The "stop" accent — deep Japanese-steel red. Critical / fail only. */
  signal: "#A6342A",

  /** Reinforcement hues — only ever shown alongside an icon + label. */
  pass: "#3E7C5A",
  warn: "#5B6B7A",
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
