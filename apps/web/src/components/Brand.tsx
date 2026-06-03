import * as React from 'react';

// The Wally wordmark — geometric, lowercase-friendly, editorial. The dot is the
// one place we let the signal red breathe in chrome (a single deliberate accent,
// never load-bearing for meaning).
export function Wordmark({
  className = '',
  withTagline = false,
}: {
  className?: string;
  withTagline?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span
        aria-hidden="true"
        className="grid h-7 w-7 place-items-center rounded-md bg-ink text-paper"
      >
        <span className="font-display text-[15px] font-semibold leading-none">w</span>
      </span>
      <div className="leading-none">
        <span className="font-display text-[17px] font-semibold tracking-tight text-ink">
          Wally
          <span className="text-signal">.</span>
        </span>
        {withTagline ? (
          <span className="mt-0.5 block text-[10px] uppercase tracking-brand text-steel">
            TCC Compliance
          </span>
        ) : null}
      </div>
    </div>
  );
}
