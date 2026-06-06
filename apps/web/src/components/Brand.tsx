import * as React from 'react';

// The Wally wordmark — geometric, lowercase-friendly, editorial. `tone="dark"`
// flips it for premium dark chrome: a gold brand mark + gold dot (the gold is
// our brand accent on chrome); on light the dot stays the deliberate red accent.
export function Wordmark({
  className = '',
  withTagline = false,
  tone = 'light',
}: {
  className?: string;
  withTagline?: boolean;
  tone?: 'light' | 'dark';
}) {
  const dark = tone === 'dark';
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span
        aria-hidden="true"
        className={
          dark
            ? 'grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-gold-bright to-gold text-chrome shadow-glow'
            : 'grid h-7 w-7 place-items-center rounded-md bg-ink text-paper'
        }
      >
        <span className="font-display text-[15px] font-semibold leading-none">w</span>
      </span>
      <div className="leading-none">
        <span
          className={`font-display text-[17px] font-semibold tracking-tight ${
            dark ? 'text-chrome-ink' : 'text-ink'
          }`}
        >
          Wally
          <span className={dark ? 'text-gold-bright' : 'text-signal'}>.</span>
        </span>
        {withTagline ? (
          <span
            className={`mt-0.5 block text-[10px] uppercase tracking-brand ${
              dark ? 'text-chrome-muted' : 'text-steel'
            }`}
          >
            TCC Compliance
          </span>
        ) : null}
      </div>
    </div>
  );
}
