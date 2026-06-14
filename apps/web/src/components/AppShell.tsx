import * as React from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { LogOut, Settings } from 'lucide-react';

import type { Role } from '@wally/sdk';

import { useLogout, useSession } from '../lib/auth';
import { Wordmark } from './Brand';

/**
 * The minimal signed-in chrome behind the standalone /settings route: brand,
 * who you are, settings, sign-out. The role workspaces (studio / store / crew)
 * each carry their own shell — this one deliberately has no primary nav.
 */
export function AppShell() {
  const { user } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();

  const onSignOut = async () => {
    await logout.mutateAsync();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="sticky top-0 z-30 border-b border-chrome-line/70 bg-chrome text-chrome-ink">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link to="/" className="shrink-0" aria-label="Wally home">
            <Wordmark tone="dark" />
          </Link>

          <div className="ml-auto flex items-center gap-3">
            {user ? (
              <div className="hidden text-right leading-tight sm:block">
                <p className="text-sm font-medium text-chrome-ink">
                  {user.name ?? user.email}
                </p>
                <p className="text-[11px] uppercase tracking-brand text-gold">
                  {roleLabel(user.role)}
                </p>
              </div>
            ) : null}
            <Link
              to="/settings"
              aria-label="Settings"
              className="grid h-9 w-9 place-items-center rounded-md text-chrome-muted transition-colors hover:bg-chrome-raised hover:text-chrome-ink"
            >
              <Settings className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={onSignOut}
              disabled={logout.isPending}
              aria-label="Sign out"
              className="inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-chrome-muted transition-colors hover:bg-chrome-raised hover:text-chrome-ink disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}

function roleLabel(role: Role): string {
  switch (role) {
    case 'ADMIN':
      return 'Admin';
    case 'REVIEWER':
      return 'Reviewer';
    case 'STORE_MANAGER':
      return 'Store manager';
    case 'VIEWER':
      return 'Viewer';
    case 'SETUP_CREW':
      return 'Setup crew';
  }
}
