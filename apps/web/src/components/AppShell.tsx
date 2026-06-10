import * as React from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LogOut, Settings, WifiOff } from 'lucide-react';

import type { Role } from '@wally/sdk';

import { useLogout, useSession } from '../lib/auth';
import { useCaptureQueue } from '../lib/captureQueue';
import { Wordmark } from './Brand';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[];
}

// The reviewer flow moved into the studio shell (/studio/review). This shell now
// only backs the standalone /settings route, so it carries no primary nav.
const NAV: NavItem[] = [];

/** Offline ribbon — the field app must always say when it has lost signal. */
function OfflineRibbon() {
  const online = useCaptureQueue((s) => s.online);
  const pending = useCaptureQueue(
    (s) => Object.values(s.items).filter((i) => i.status !== 'done').length,
  );
  if (online) return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-graphite px-4 py-1.5 text-center text-xs font-medium text-paper">
      <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
      <span>
        Offline — {pending} capture{pending === 1 ? '' : 's'} saved on this device,
        will upload when you reconnect.
      </span>
    </div>
  );
}

/** The signed-in chrome: brand, role-aware nav, sign-out. */
export function AppShell() {
  const { user } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();

  const items = NAV.filter((n) => (user ? n.roles.includes(user.role) : false));

  const onSignOut = async () => {
    await logout.mutateAsync();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <OfflineRibbon />
      <header className="sticky top-0 z-30 border-b border-black/40 bg-chrome text-chrome-ink">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link to="/" className="shrink-0" aria-label="Wally home">
            <Wordmark tone="dark" />
          </Link>

          {items.length > 1 ? (
            <nav className="ml-2 hidden items-center gap-1 sm:flex">
              {items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) =>
                    [
                      'group inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-base ease-out',
                      isActive
                        ? 'bg-chrome-raised text-chrome-ink'
                        : 'text-chrome-muted hover:bg-chrome-raised/70 hover:text-chrome-ink',
                    ].join(' ')
                  }
                >
                  {({ isActive }) => (
                    <>
                      <n.icon
                        className={`h-4 w-4 ${isActive ? 'text-gold-bright' : ''}`}
                      />
                      {n.label}
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
          ) : null}

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
