import * as React from "react";

import { cn } from "../lib/cn";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "signal" | "outline";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  // Ink on paper — the calm default CTA.
  primary:
    "bg-ink text-paper hover:bg-graphite focus-visible:ring-ink/40",
  // Quiet surface fill.
  secondary:
    "bg-surface text-ink hover:bg-mist/40 focus-visible:ring-steel/30",
  // No chrome until hover.
  ghost:
    "bg-transparent text-graphite hover:bg-surface focus-visible:ring-steel/30",
  // The one accent — destructive / stop. Reserve for genuine stop actions.
  signal:
    "bg-signal text-paper hover:bg-signal/90 focus-visible:ring-signal/40",
  // Hairline outline.
  outline:
    "border border-mist bg-transparent text-ink hover:bg-surface focus-visible:ring-steel/30",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-6 text-sm",
  icon: "h-9 w-9",
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
        "inline-flex items-center justify-center gap-2 rounded-md font-sans font-medium",
        "transition-colors duration-base ease-standard",
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
