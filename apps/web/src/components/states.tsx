import * as React from 'react';
import { AlertTriangle, Inbox, type LucideIcon } from 'lucide-react';
import { Button } from '@wally/ui';

import { errorMessage } from '../lib/api';

/** Centered, calm placeholder for an empty list. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  body,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-mist/80 bg-surface/40 px-6 py-14 text-center">
      <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-surface text-steel">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="font-display text-base font-semibold text-ink">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-sm text-steel">{body}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

/** Inline error panel with a retry affordance. */
export function ErrorState({
  error,
  onRetry,
  title = 'Could not load this',
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div className="rounded-lg border border-signal/30 bg-signal/[0.06] px-5 py-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-signal" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-ink">{title}</p>
          <p className="mt-1 break-words text-sm text-graphite">{errorMessage(error)}</p>
          {onRetry ? (
            <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Shimmer block for loading skeletons. */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-mist/30 ${className}`}
    />
  );
}
