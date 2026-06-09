import * as React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, Menu, Store as StoreIcon, X } from 'lucide-react';

import { api } from '../lib/api';
import { StoreSwitcher } from '../components/StoreSwitcher';
import { ManagerSidebar } from './ManagerSidebar';
import { ManagerStoreProvider, useManagerStore } from './ManagerStoreContext';

export function ManagerShell() {
  return (
    <ManagerStoreProvider>
      <ManagerChrome />
    </ManagerStoreProvider>
  );
}

function ManagerChrome() {
  const [drawer, setDrawer] = React.useState(false);

  return (
    <div className="flex h-dvh overflow-hidden bg-paper text-ink">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex">
        <ManagerSidebar />
      </div>

      {/* Mobile drawer */}
      {drawer ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/30 backdrop-blur-sm"
            onClick={() => setDrawer(false)}
          />
          <div className="absolute left-0 top-0 h-full bg-paper shadow-lift">
            <button
              type="button"
              onClick={() => setDrawer(false)}
              aria-label="Close menu"
              className="absolute right-2 top-3 z-10 grid h-8 w-8 place-items-center rounded-md text-steel hover:bg-surface"
            >
              <X className="h-4 w-4" />
            </button>
            <ManagerSidebar onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <ManagerTopBar onMenu={() => setDrawer(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function ManagerTopBar({ onMenu }: { onMenu: () => void }) {
  const { storeId, stores, canSwitch, setStoreId } = useManagerStore();
  const homeQ = useQuery({
    queryKey: ['manager', 'home', storeId],
    queryFn: () => api.manager.home(storeId),
  });
  const unseen = homeQ.data?.unseenTasks ?? 0;
  const storeName = homeQ.data?.storeName;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-mist/60 bg-paper/85 px-4 backdrop-blur sm:px-5">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open menu"
        className="grid h-9 w-9 place-items-center rounded-md text-graphite hover:bg-surface lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="min-w-0 flex-1">
        {canSwitch && stores.length > 0 ? (
          <StoreSwitcher
            stores={stores.map((s) => ({ storeId: s.id, storeName: s.name }))}
            value={storeId}
            onChange={setStoreId}
            placeholder="View store"
            className="w-56 max-w-full"
          />
        ) : storeName ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
            <StoreIcon className="h-3.5 w-3.5 text-steel" />
            {storeName}
          </span>
        ) : null}
      </div>

      <NavLink
        to="/store/tasks"
        aria-label={`Tasks${unseen ? `, ${unseen} new` : ''}`}
        className="relative grid h-9 w-9 place-items-center rounded-md text-graphite hover:bg-surface"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unseen > 0 ? (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-gold px-1 text-[10px] font-semibold leading-none text-chrome-ink">
            {unseen}
          </span>
        ) : null}
      </NavLink>
    </header>
  );
}
