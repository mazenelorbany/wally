import * as React from "react";
import {
  Check,
  CheckCircle2,
  CircleDashed,
  HelpCircle,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { cn } from "../lib/cn";
import {
  criterionMeta,
  verdictMeta,
  type VerdictIconName,
  type VerdictKey,
  type VerdictMeta,
} from "../tokens/colors";

/**
 * The colour-blind-safe verdict chip — the brand's load-bearing atom.
 *
 * Meaning is carried by an ICON + a text LABEL; colour is reinforcement only.
 * The GRB CEO is colour blind (sees red), so no verdict is ever distinguished
 * by hue alone. Use this everywhere a Verdict / Overall band is shown — never a
 * bare coloured badge.
 */

/** Resolve the string icon names kept in the (runtime-pure) token module to the
 *  actual lucide components here, where importing React is fine. */
const icons: Record<VerdictIconName, LucideIcon> = {
  CheckCircle2,
  Check,
  XCircle,
  HelpCircle,
  CircleDashed,
};

type Tone = "perfect" | "good" | "not_good" | "needs_review" | "incomplete";
type CriterionTone = "pass" | "fail" | "unsure";

/** Accepts the API's snake_case `Overall` / store band, or a per-criterion
 *  value, and normalises both into the token maps. */
export type VerdictTone = Tone | CriterionTone;

type Size = "sm" | "md" | "lg";

const sizes: Record<
  Size,
  { chip: string; icon: string; label: string }
> = {
  sm: { chip: "h-6 gap-1 px-2 text-[11px]", icon: "h-3.5 w-3.5", label: "leading-none" },
  md: { chip: "h-7 gap-1.5 px-2.5 text-xs", icon: "h-4 w-4", label: "leading-none" },
  lg: { chip: "h-9 gap-2 px-3 text-sm", icon: "h-[18px] w-[18px]", label: "leading-none" },
};

function resolveMeta(tone: VerdictTone): VerdictMeta {
  if (tone in verdictMeta) {
    return verdictMeta[tone as VerdictKey];
  }
  return criterionMeta[tone as CriterionTone];
}

export interface VerdictProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Verdict band: `perfect | good | not_good | needs_review | incomplete`,
   *  or a per-criterion `pass | fail | unsure`. */
  tone: VerdictTone;
  size?: Size;
  /** Hide the text label, keeping only the icon (still accessible via
   *  `aria-label`). Use sparingly — the label is the point. */
  iconOnly?: boolean;
  /** Override the default human label (e.g. localised copy). */
  label?: string;
}

/** Icon + label chip. Colour-blind safe: icon and word carry the meaning. */
export const Verdict = React.forwardRef<HTMLSpanElement, VerdictProps>(
  ({ tone, size = "md", iconOnly = false, label, className, ...rest }, ref) => {
    const meta = resolveMeta(tone);
    const Icon = icons[meta.icon];
    const s = sizes[size];
    const text = label ?? meta.label;

    return (
      <span
        ref={ref}
        role="status"
        aria-label={text}
        className={cn(
          "inline-flex items-center rounded-md border font-sans font-medium",
          meta.className,
          s.chip,
          iconOnly && "aspect-square justify-center px-0",
          className,
        )}
        {...rest}
      >
        <Icon className={cn("shrink-0", s.icon)} aria-hidden="true" />
        {iconOnly ? null : <span className={s.label}>{text}</span>}
      </span>
    );
  },
);
Verdict.displayName = "Verdict";
