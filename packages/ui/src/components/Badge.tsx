import * as React from "react";

import { cn } from "../lib/cn";

type Variant =
  | "default"
  | "outline"
  | "muted"
  | "signal"
  | "pass"
  | "warn";

const variants: Record<Variant, string> = {
  default: "bg-ink/10 text-ink",
  outline: "border border-mist text-graphite",
  muted: "bg-surface text-steel",
  // Reinforcement variants — when used as a verdict, pair with an icon/label
  // (use the <Verdict> atom instead of a bare colour badge).
  signal: "bg-signal/10 text-signal border border-signal/30",
  pass: "bg-pass/10 text-pass border border-pass/30",
  warn: "bg-warn/10 text-warn border border-warn/30",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

/** Small typographic chip. Lowercase-friendly, geometric. */
export function Badge({ className, variant = "default", ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-sans text-[11px] font-medium leading-5",
        variants[variant],
        className,
      )}
      {...rest}
    />
  );
}
