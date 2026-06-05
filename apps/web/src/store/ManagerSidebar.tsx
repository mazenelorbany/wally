import * as React from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  GraduationCap,
  Home,
  ListChecks,
  LogOut,
  Map as MapIcon,
  Megaphone,
  Package,
  Receipt,
  Settings,
  type LucideIcon,
} from 'lucide-react';

import { api } from '../lib/api';
import { useLogout, useSession } from '../lib/auth';
import { useManagerStore } from './ManagerStoreContext';

interface NavItem {
  label: string;
  icon: LucideIcon;
  to: string;
  end?: boolean;
  badge?: number;
}

/**
 * The store manager's primary navigation — same shape as the studio Sidebar
 * (grouped nav + account footer) so admins and managers share one mental model.
 */
export function ManagerSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { storeId } = useManagerStore();
  const homeQ = useQuery({
    queryKey: ['manager', 'home', storeId],
    queryFn: () => api.manager.home(storeId),
  });
  const unseen = homeQ.data?.unseenTasks ?? 0;

  const bulletinsQ = useQuery({
    queryKey: ['manager', 'bulletins', storeId],
    queryFn: () => api.bulletins.mine(storeId),
  });
  const unreadBulletins = (bulletinsQ.data ?? []).filter((b) => !b.acknowledged).length;

  const items: NavItem[] = [
    { label: 'Home', icon: Home, to: '/store', end: true },
    { label: 'Tasks', icon: ListChecks, to: '/store/tasks', badge: unseen },
    { label: 'Bulletins', icon: Megaphone, to: '/store/bulletins', badge: unreadBulletins },
    { label: 'Floor map', icon: MapIcon, to: '/store/guide' },
    { label: 'Log sales', icon: Receipt, to: '/store/sales' },
    { label: 'Products', icon: Package, to: '/store/products' },
    { label: 'Training', icon: GraduationCap, to: '/store/resources' },
  ];

  return (
    <nav
      aria-label="Store navigation"
      className="flex h-full w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-mist/60 bg-surface/40 px-3 py-5"
    >
      <div className="flex items-center gap-2 px-2">
        <span
          aria-hidden="true"
          className="grid h-7 w-7 place-items-center rounded-md bg-ink text-paper"
        >
          <span className="font-display text-sm font-bold">W</span>
        </span>
        <span className="font-display text-sm font-semibold tracking-tight text-ink">
          Wally<span className="text-fail">.</span>
        </span>
      </div>

      <div>
        <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-brand text-steel">
          Your store
        </p>
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                [
                  'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-paper font-medium text-ink shadow-card'
                    : 'text-graphite hover:bg-paper hover:text-ink',
                ].join(' ')
              }
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
              <span className="flex-1 truncate">{item.label}</span>
              {item.badge ? (
                <span className="grid h-4 min-w-4 place-items-center rounded-full bg-signal px-1 text-[10px] font-semibold leading-none text-paper">
                  {item.badge}
                </span>
              ) : null}
            </NavLink>
          ))}
        </div>
      </div>

      <ManagerAccount />
    </nav>
  );
}

function ManagerAccount() {
  const { user } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();

  const signOut = async () => {
    await logout.mutateAsync();
    navigate('/login', { replace: true });
  };

  return (
    <div className="mt-auto border-t border-mist/60 pt-3">
      <div className="px-2 pb-2">
        <p className="truncate text-sm font-medium text-ink">
          {user?.name ?? user?.email ?? 'Signed in'}
        </p>
        <p className="text-[10px] uppercase tracking-brand text-steel">Store manager</p>
      </div>
      <Link
        to="/store/settings"
        className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-graphite transition-colors hover:bg-paper hover:text-ink"
      >
        <Settings className="h-[18px] w-[18px]" />
        Settings
      </Link>
      <button
        type="button"
        onClick={signOut}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-steel transition-colors hover:bg-paper hover:text-signal"
      >
        <LogOut className="h-[18px] w-[18px]" />
        Sign out
      </button>
    </div>
  );
}
