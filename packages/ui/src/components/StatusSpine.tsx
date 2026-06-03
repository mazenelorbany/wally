import * as React from "react";
import { AlertCircle, Check, Loader2, type LucideIcon } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * StatusSpine — a vertical progression rail for a pipeline's lifecycle (e.g. a
 * Submission moving photo → ScoreJob PENDING → RUNNING → DONE, or a review
 * flow). Each node is a labelled step with one of four states; the connecting
 * spine fills as steps complete.
 *
 * Colour-blind safe: each state has a distinct ICON and the active/done states
 * carry text. Nothing is distinguished by hue alone.
 */

export type StepState = "done" | "active" | "pending" | "failed";

export interface SpineStep {
  /** Stable key. */
  id: string;
  /** Short step label. */
  label: string;
  /** Optional secondary line (timestamp, detail, store name). */
  meta?: string;
  state: StepState;
}

const nodeIcon: Record<StepState, LucideIcon | null> = {
  done: Check,
  active: Loader2,
  failed: AlertCircle,
  pending: null,
};

const nodeRing: Record<StepState, string> = {
  done: "border-graphite bg-graphite text-paper",
  active: "border-ink bg-paper text-ink",
  failed: "border-signal bg-signal/10 text-signal",
  pending: "border-mist bg-paper text-mist",
};

const labelTone: Record<StepState, string> = {
  done: "text-graphite",
  active: "text-ink font-medium",
  failed: "text-signal font-medium",
  pending: "text-steel",
};

export interface StatusSpineProps
  extends React.HTMLAttributes<HTMLOListElement> {
  steps: SpineStep[];
}

/** Vertical labelled progress rail. */
export const StatusSpine = React.forwardRef<HTMLOListElement, StatusSpineProps>(
  ({ steps, className, ...rest }, ref) => (
    <ol ref={ref} className={cn("flex flex-col", className)} {...rest}>
      {steps.map((step, i) => {
        const Icon = nodeIcon[step.state];
        const isLast = i === steps.length - 1;
        // The spine segment below this node is "filled" once this step is done.
        const filled = step.state === "done";

        return (
          <li key={step.id} className="relative flex gap-3 pb-5 last:pb-0">
            {/* Connector */}
            {isLast ? null : (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-[11px] top-6 bottom-0 w-px",
                  filled ? "bg-graphite" : "bg-mist",
                )}
              />
            )}

            {/* Node */}
            <span
              aria-hidden="true"
              className={cn(
                "relative z-10 mt-0.5 flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border-2",
                nodeRing[step.state],
              )}
            >
              {Icon ? (
                <Icon
                  className={cn(
                    "h-3 w-3",
                    step.state === "active" && "animate-wally-spin",
                  )}
                />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              )}
            </span>

            {/* Copy */}
            <div className="min-w-0 pt-0.5">
              <p className={cn("font-sans text-sm leading-tight", labelTone[step.state])}>
                {step.label}
              </p>
              {step.meta ? (
                <p className="mt-0.5 truncate font-sans text-xs text-steel">
                  {step.meta}
                </p>
              ) : null}
            </div>

            {/* Screen-reader state, since icon is decorative. */}
            <span className="sr-only">{`(${step.state})`}</span>
          </li>
        );
      })}
    </ol>
  ),
);
StatusSpine.displayName = "StatusSpine";
