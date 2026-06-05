import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, LogOut, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { Button, Card } from '@wally/ui';

import { useLogout, useSession } from '../lib/auth';

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Admin',
  REVIEWER: 'Reviewer',
  STORE_MANAGER: 'Store manager',
};

/** Shared settings surface for the admin / reviewer chromes (profile + sign out). */
export function SettingsPage() {
  const { user } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const [notify, setNotify] = React.useState(true);

  const signOut = async () => {
    await logout.mutateAsync();
    navigate('/login', { replace: true });
  };

  return (
    <div className="mx-auto max-w-lg px-6 py-10">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Settings
        </h1>
        <p className="mt-0.5 text-sm text-steel">Your account and preferences.</p>
      </header>

      <Card className="divide-y divide-mist/40">
        <Row icon={UserRound} label="Name" value={user?.name ?? '—'} />
        <Row icon={Mail} label="Email" value={user?.email ?? '—'} />
        <Row
          icon={ShieldCheck}
          label="Role"
          value={user ? ROLE_LABEL[user.role] ?? user.role : '—'}
        />
      </Card>

      <h2 className="mb-2 mt-6 text-[11px] uppercase tracking-brand text-steel">
        Notifications
      </h2>
      <Card className="p-4">
        <label className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2.5">
            <Bell className="h-4 w-4 text-graphite" />
            <span className="text-sm text-ink">Email me when stores need chasing</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={notify}
            onClick={() => setNotify((v) => !v)}
            className={`relative h-6 w-10 rounded-full transition-colors ${
              notify ? 'bg-ink' : 'bg-mist'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-paper transition-transform ${
                notify ? 'translate-x-[18px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </label>
      </Card>

      <Button
        variant="outline"
        className="mt-6 w-full text-signal"
        onClick={signOut}
        loading={logout.isPending}
      >
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
      <span className="w-16 shrink-0 text-[11px] uppercase tracking-brand text-steel">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate text-right text-sm font-medium text-ink">
        {value}
      </span>
    </div>
  );
}
