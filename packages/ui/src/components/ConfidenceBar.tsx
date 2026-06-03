import * as React from "react";

import { cn } from "../lib/cn";

/**
 * A slim, accessible confidence meter.
 *
 * Confidence is a 0..1 score from the scorer. Below the floor it reads as a
 * needs-review band (warn), otherwise it reads as settled (graphite). Colour is
 * reinforcement only — the numeric percentage label is always present, and the
 * track is announced as a `progressbar` with its value, so the bar is legible
 * without hue.
 */

type Size = "sm" | "md";

const trackSizes: Record<Size, string> = {
  sm: "h-1",
  md: "h-1.5",
};

export interface ConfidenceBarProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** Confidence in 0..1 (clamped). */
  value: number;
  /** Floor below which the scorer routes to needs-review. Default 0.6. */
  floor?: number;
  size?: Size;
  /** Show the numeric "NN%" label beside the track. Default true. */
  showValue?: boolean;
  /** Accessible name for the meter. */
  label?: string;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/** Horizontal confidence meter with an always-present percentage. */
export const ConfidenceBar = React.forwardRef<HTMLDivElement, ConfidenceBarProps>(
  (
    {
      value,
      floor = 0.6,
      size = "md",
      showValue = true,
      label = "Confidence",
      className,
      ...rest
    },
    ref,
  ) => {
    const v = clamp01(value);
    const pct = Math.round(v * 100);
    const low = v < floor;

    return (
      <div
        ref={ref}
        className={cn("flex items-center gap-2", className)}
        {...rest}
      >
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={`${pct}%${low ? " — below review threshold" : ""}`}
          className={cn(
            "relative w-full overflow-hidden rounded-full bg-mist/40",
            trackSizes[size],
          )}
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-slow ease-out",
              low ? "bg-warn" : "bg-graphite",
            )}
            style={{ width: `${pct}%` }}
          />
          {/* Floor tick — a hairline reference so "low" is visible structurally,
              not by colour alone. */}
          <span
            aria-hidden="true"
            className="absolute inset-y-0 w-px bg-ink/25"
            style={{ left: `${Math.round(clamp01(floor) * 100)}%` }}
          />
        </div>
        {showValue ? (
          <span
            className={cn(
              "shrink-0 font-sans text-xs tabular-nums",
              low ? "text-warn" : "text-steel",
            )}
          >
            {pct}%
          </span>
        ) : null}
      </div>
    );
  },
);
ConfidenceBar.displayName = "ConfidenceBar";
