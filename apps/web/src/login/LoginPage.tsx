import * as React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Mail } from 'lucide-react';
import type { Role } from '@wally/types';
import { Button, Card } from '@wally/ui';

import {
  homeForRole,
  useDevLogin,
  useRequestMagicLink,
  useSession,
} from '../lib/auth';
import { errorMessage } from '../lib/api';
import { Wordmark } from '../components/Brand';

// Show the one-click role shortcuts in local dev, or in a hosted demo build
// (VITE_DEMO=1, paired with DEMO_LOGIN=1 on the API).
const DEV = import.meta.env.DEV || import.meta.env.VITE_DEMO === '1';

const DEV_ROLES: { role: Role; label: string; blurb: string }[] = [
  { role: 'STORE_MANAGER', label: 'Store manager', blurb: 'Capture fixtures' },
  { role: 'REVIEWER', label: 'Reviewer', blurb: 'Work the queue' },
  { role: 'ADMIN', label: 'Admin', blurb: 'Everything' },
  { role: 'SETUP_CREW', label: 'Setup crew', blurb: 'Floor plan + fixtures' },
  { role: 'VIEWER', label: 'Viewer', blurb: 'Read-only' },
];

export function LoginPage() {
  const { user } = useSession();
  const location = useLocation();
  const requestLink = useRequestMagicLink();
  const devLogin = useDevLogin();

  const [email, setEmail] = React.useState('');
  const [sentTo, setSentTo] = React.useState<string | null>(null);

  // Already signed in? Send them where they were going, or to their home.
  if (user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? homeForRole(user.role)} replace />;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    await requestLink.mutateAsync(trimmed);
    setSentTo(trimmed);
  };

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-chrome px-4 py-10">
      {/* a faint gold aura behind the lockup — premium, never load-bearing */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[28%] h-72 w-72 -translate-x-1/2 rounded-full bg-gold/10 blur-3xl"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Wordmark className="scale-110" withTagline tone="dark" />
          <h1 className="mt-6 font-display text-xl font-semibold tracking-tight text-chrome-ink">
            Sign in
          </h1>
          <p className="mt-1 text-sm text-chrome-muted">
            We send a one-time link to your work email — no password to remember.
          </p>
        </div>

        <Card className="p-6">
          {sentTo ? (
            <div className="flex flex-col items-center text-center">
              <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-pass/10 text-pass">
                <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
              </span>
              <p className="font-display text-base font-semibold text-ink">
                Check your inbox
              </p>
              <p className="mt-1 text-sm text-steel">
                We sent a sign-in link to <strong className="text-graphite">{sentTo}</strong>.
                It expires in 20 minutes.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-4"
                onClick={() => setSentTo(null)}
              >
                Use a different email
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-3">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-graphite">
                  Work email
                </span>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel"
                    aria-hidden="true"
                  />
                  <input
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@thecookwarecompany.com"
                    className="field pl-9"
                  />
                </div>
              </label>

              {requestLink.isError ? (
                <p className="text-sm text-signal">{errorMessage(requestLink.error)}</p>
              ) : null}

              <Button
                type="submit"
                size="lg"
                variant="gold"
                className="mt-1 w-full"
                loading={requestLink.isPending}
              >
                Send sign-in link
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          )}
        </Card>

        {DEV ? (
          <div className="mt-6">
            <p className="mb-2 text-center text-[11px] uppercase tracking-brand text-chrome-muted">
              Dev shortcut
            </p>
            <div className="grid grid-cols-3 gap-2">
              {DEV_ROLES.map((r) => (
                <button
                  key={r.role}
                  type="button"
                  onClick={() => devLogin.mutate(r.role)}
                  disabled={devLogin.isPending}
                  className="tap rounded-md border border-chrome-line bg-chrome-raised px-2 py-2.5 text-center transition-colors hover:border-gold/50 disabled:opacity-50"
                >
                  <span className="block text-xs font-medium text-chrome-ink">{r.label}</span>
                  <span className="mt-0.5 block text-[10px] text-chrome-muted">{r.blurb}</span>
                </button>
              ))}
            </div>
            {devLogin.isError ? (
              <p className="mt-2 text-center text-xs text-signal">
                {errorMessage(devLogin.error)}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
