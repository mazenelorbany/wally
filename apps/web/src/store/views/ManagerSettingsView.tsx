import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, LogOut, Mail, Store as StoreIcon, UserRound } from 'lucide-react';
import { Button, Card, Spinner } from '@wally/ui';

import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useLogout, useSession } from '../../lib/auth';
import { useManagerStore } from '../ManagerStoreContext';

/** Manager settings: who you are, your store, notification prefs, sign out. */
export function ManagerSettingsView() {
  const { user } = useSession();
  const { stores, storeId } = useManagerStore();
  const logout = useLogout();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  // The "New task alerts" preference is real now: a User.notifyOnNewTask column
  // read/written through the manager-preferences endpoint.
  const prefsQ = useQuery({
    queryKey: ['manager', 'preferences'],
    queryFn: () => api.manager.preferences(),
  });
  const notify = prefsQ.data?.notifyOnNewTask ?? true;

  const setNotify = useMutation({
    mutationFn: (value: boolean) =>
      api.manager.updatePreferences({ notifyOnNewTask: value }),
    onMutate: async (value) => {
      // Optimistic flip so the switch responds instantly.
      await qc.cancelQueries({ queryKey: ['manager', 'preferences'] });
      const prev = qc.getQueryData(['manager', 'preferences']);
      qc.setQueryData(['manager', 'preferences'], { notifyOnNewTask: value });
      return { prev };
    },
    onError: (e, _value, ctx) => {
      if (ctx?.prev) qc.setQueryData(['manager', 'preferences'], ctx.prev);
      toast.error(errorMessage(e));
    },
    onSuccess: (data) => qc.setQueryData(['manager', 'preferences'], data),
  });

  const storeName =
    stores.find((s) => s.id === storeId)?.name ?? user?.storeId ?? '—';

  const signOut = async () => {
    await logout.mutateAsync();
    navigate('/login', { replace: true });
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Settings
        </h1>
      </header>

      <Card className="divide-y divide-mist/40">
        <Row icon={UserRound} label="Name" value={user?.name ?? '—'} />
        <Row icon={Mail} label="Email" value={user?.email ?? '—'} />
        <Row icon={StoreIcon} label="Store" value={storeName} />
      </Card>

      <section>
        <h2 className="mb-2 text-[11px] uppercase tracking-brand text-steel">
          Notifications
        </h2>
        <Card className="p-4">
          <label className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2.5">
              <Bell className="h-4 w-4 text-graphite" />
              <span className="text-sm text-ink">New task alerts</span>
            </span>
            {prefsQ.isLoading ? (
              <Spinner className="text-base text-steel" />
            ) : (
              <button
                type="button"
                role="switch"
                aria-checked={notify}
                aria-label="New task alerts"
                disabled={setNotify.isPending || prefsQ.isError}
                onClick={() => setNotify.mutate(!notify)}
                className={`relative h-6 w-10 rounded-full transition-colors disabled:opacity-60 ${
                  notify ? 'bg-ink' : 'bg-mist'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-paper transition-transform ${
                    notify ? 'translate-x-[18px]' : 'translate-x-0.5'
                  }`}
                />
              </button>
            )}
          </label>
          {prefsQ.isError ? (
            <p className="mt-2 text-xs text-signal">
              Couldn't load your notification preference.
            </p>
          ) : null}
        </Card>
      </section>

      <Button variant="outline" className="w-full text-signal" onClick={signOut} loading={logout.isPending}>
        <LogOut className="h-4 w-4" />
        Sign out
      </Button>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <Icon className="h-4 w-4 shrink-0 text-steel" />
      <span className="w-20 shrink-0 text-[11px] uppercase tracking-brand text-steel">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate text-right text-sm font-medium text-ink">
        {value}
      </span>
    </div>
  );
}
