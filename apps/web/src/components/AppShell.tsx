import * as React from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Camera, ClipboardList, LogOut, Settings, WifiOff } from 'lucide-react';
import { Button } from '@wally/ui';

import { useLogout, useSession } from '../lib/auth';
import { useCaptureQueue } from '../lib/captureQueue';
import { Wordmark } from './Brand';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Array<'ADMIN' | 'REVIEWER' | 'STORE_MANAGER' | 'VIEWER'>;
}

const NAV: NavItem[] = [
  { to: '/capture', label: 'Capture', icon: Camera, roles: ['STORE_MANAGER', 'ADMIN'] },
  { to: '/console', label: 'Console', icon: ClipboardList, roles: ['REVIEWER', 'ADMIN'] },
];

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
      <header className="sticky top-0 z-30 border-b border-mist/60 bg-paper/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link to="/" className="shrink-0" aria-label="Wally home">
            <Wordmark />
          </Link>

          {items.length > 1 ? (
            <nav className="ml-2 hidden items-center gap-1 sm:flex">
              {items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) =>
                    [
                      'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-surface text-ink'
                        : 'text-steel hover:bg-surface/70 hover:text-graphite',
                    ].join(' ')
                  }
                >
                  <n.icon className="h-4 w-4" />
                  {n.label}
                </NavLink>
              ))}
            </nav>
          ) : null}

          <div className="ml-auto flex items-center gap-3">
            {user ? (
              <div className="hidden text-right leading-tight sm:block">
                <p className="text-sm font-medium text-ink">{user.name ?? user.email}</p>
                <p className="text-[11px] uppercase tracking-brand text-steel">
                  {roleLabel(user.role)}
                </p>
              </div>
            ) : null}
            <Link
              to="/settings"
              aria-label="Settings"
              className="grid h-9 w-9 place-items-center rounded-md text-steel hover:bg-surface hover:text-graphite"
            >
              <Settings className="h-4 w-4" />
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={onSignOut}
              loading={logout.isPending}
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}

function roleLabel(role: 'ADMIN' | 'REVIEWER' | 'STORE_MANAGER' | 'VIEWER'): string {
  switch (role) {
    case 'ADMIN':
      return 'Admin';
    case 'REVIEWER':
      return 'Reviewer';
    case 'STORE_MANAGER':
      return 'Store manager';
    case 'VIEWER':
      return 'Viewer';
  }
}
