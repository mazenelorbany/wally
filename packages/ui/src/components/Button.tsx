import * as React from "react";

import { cn } from "../lib/cn";
import { Spinner } from "./Spinner";

type Variant =
  | "primary"
  | "secondary"
  | "ghost"
  | "signal"
  | "outline"
  | "gold";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  // Ink on paper — the calm default CTA. A whisper of inner light on top so
  // the fill reads dimensional (the Stripe button trick). Gold focus ring.
  primary:
    "bg-ink text-paper shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_1px_2px_rgba(20,23,31,0.24)] hover:bg-graphite focus-visible:ring-gold/55",
  // Quiet surface fill.
  secondary:
    "bg-surface text-ink hover:bg-mist/50 focus-visible:ring-gold/45",
  // No chrome until hover.
  ghost:
    "bg-transparent text-graphite hover:bg-surface hover:text-ink focus-visible:ring-gold/45",
  // The one accent — destructive / stop. Reserve for genuine stop actions.
  signal:
    "bg-signal text-paper shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_2px_rgba(201,44,38,0.28)] hover:bg-signal/90 focus-visible:ring-signal/45",
  // White + hairline + soft drop — the Stripe secondary.
  outline:
    "border border-mist bg-white text-ink shadow-[0_1px_2px_rgba(20,23,31,0.05)] hover:border-steel/60 hover:bg-surface/60 focus-visible:ring-gold/45",
  // The brand accent — Cuisine::pro red for a headline CTA.
  gold:
    "bg-gold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(122,0,0,0.35)] hover:bg-gold-bright focus-visible:ring-gold/55",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3.5 text-[13px]",
  lg: "h-10 px-5 text-sm",
  icon: "h-8 w-8",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and disables interaction. */
  loading?: boolean;
}

/**
 * The single source for in-app buttons. Geometric, calm, editorial — ink-on-
 * paper by default; `signal` reserved for stop actions. Spinner replaces no
 * content, it sits inline so the label never jumps.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      type = "button",
      loading = false,
      disabled,
      children,
      ...rest
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-sans font-medium [&_svg]:shrink-0",
        // Specific properties (never `all`); ease-out + a subtle press so the
        // button feels like it heard you (emil craft).
        "transition-[transform,background-color,border-color,box-shadow,color] duration-base ease-out",
        "active:scale-[0.97]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="text-current" /> : null}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
