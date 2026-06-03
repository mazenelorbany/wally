import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "../lib/cn";

/**
 * Tooltip — a thin wrapper over Radix Tooltip with the TCC surface treatment.
 *
 * Provide a single <TooltipProvider> high in the app tree, then use the
 * <Tooltip> / <TooltipTrigger> / <TooltipContent> trio per instance. Tooltips
 * are supplementary only — never the sole carrier of meaning (the spec's
 * verdicts always have a visible icon + label).
 */

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, children, ...rest }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 max-w-xs rounded-md border border-graphite/20 bg-ink px-2.5 py-1.5",
        "font-sans text-xs leading-snug text-paper shadow-raised",
        "data-[state=delayed-open]:animate-wally-fade-in",
        className,
      )}
      {...rest}
    >
      {children}
      <TooltipPrimitive.Arrow className="fill-ink" width={10} height={5} />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;
