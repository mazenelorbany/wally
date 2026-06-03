import * as React from "react";

import { cn } from "../lib/cn";

/**
 * Brandmark — the WALLY wordmark.
 *
 * Geometric, wide tracking, ink on paper, with the single signal-red dot as
 * the only accent (the brand's one permitted colour). The dot is decorative;
 * the accessible name is always the plain word "Wally".
 *
 * Keep it quiet — this is a wordmark, not a logo lockup. Use `tone="inverse"`
 * on dark surfaces (e.g. a signal-red or ink banner).
 */

type Size = "sm" | "md" | "lg";
type Tone = "default" | "inverse" | "mono";

const sizes: Record<Size, string> = {
  sm: "text-sm",
  md: "text-lg",
  lg: "text-2xl",
};

const wordTone: Record<Tone, string> = {
  default: "text-ink",
  inverse: "text-paper",
  mono: "text-current",
};

const dotTone: Record<Tone, string> = {
  // The one accent.
  default: "bg-signal",
  // On dark, keep the dot legible without leaning on hue.
  inverse: "bg-paper",
  mono: "bg-current",
};

export interface BrandmarkProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  size?: Size;
  tone?: Tone;
  /** Hide the trailing accent dot (e.g. inside dense nav). */
  hideDot?: boolean;
  /** Override the accessible label. */
  label?: string;
}

/** The WALLY wordmark — geometric, wide-tracked, one red accent dot. */
export const Brandmark = React.forwardRef<HTMLSpanElement, BrandmarkProps>(
  (
    {
      size = "md",
      tone = "default",
      hideDot = false,
      label = "Wally",
      className,
      ...rest
    },
    ref,
  ) => (
    <span
      ref={ref}
      role="img"
      aria-label={label}
      className={cn(
        "inline-flex items-baseline font-display font-semibold uppercase leading-none tracking-brand",
        "select-none",
        sizes[size],
        wordTone[tone],
        className,
      )}
      {...rest}
    >
      <span aria-hidden="true">Wally</span>
      {hideDot ? null : (
        <span
          aria-hidden="true"
          className={cn(
            "ml-[0.12em] inline-block h-[0.28em] w-[0.28em] translate-y-[-0.04em] rounded-full",
            dotTone[tone],
          )}
        />
      )}
    </span>
  ),
);
Brandmark.displayName = "Brandmark";
