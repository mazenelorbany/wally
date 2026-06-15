import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users as UsersIcon } from 'lucide-react';
import { Badge, Button, Spinner, cn } from '@wally/ui';
import type { StoreDto, UserDto } from '@wally/types';

import { api, errorMessage } from '../../lib/api';
import { useSession } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { EmptyState, ErrorState } from '../../components/states';
import { useSetStudioTopBar } from '../components/StudioContext';

const ROLES = [
  'ADMIN',
  'REVIEWER',
  'STORE_MANAGER',
  'SETUP_CREW',
  'VIEWER',
] as const;
type RoleStr = (typeof ROLES)[number];
const ROLE_LABEL: Record<RoleStr, string> = {
  ADMIN: 'Admin',
  REVIEWER: 'Reviewer',
  STORE_MANAGER: 'Store manager',
  SETUP_CREW: 'Setup crew',
  VIEWER: 'Viewer',
};
const fieldCls =
  'rounded-md border border-mist/70 bg-paper px-2.5 py-1.5 text-sm text-ink focus:border-graphite focus:outline-none';

/** Admin: invite teammates, set roles, assign managers to stores, deactivate. */
export function UsersView() {
  const { user: me } = useSession();
  useSetStudioTopBar({ guideName: 'Users', stores: [] });

  const usersQ = useQuery({
    queryKey: ['studio', 'admin-users'],
    queryFn: () => api.adminUsers.list(),
  });
  const storesQ = useQuery({
    queryKey: ['studio', 'admin-stores'],
    queryFn: () => api.stores.list(),
  });
  const [inviting, setInviting] = React.useState(false);
  const stores = storesQ.data ?? [];
  const users = usersQ.data ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-brand text-steel">Admin</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
            Users
          </h1>
          <p className="mt-1 text-sm text-steel">
            Invite teammates, set their role, assign managers to a store, and
            deactivate access.
          </p>
        </div>
        <Button
          onClick={() => setInviting((v) => !v)}
          variant={inviting ? 'outline' : undefined}
        >
          {inviting ? (
            'Cancel'
          ) : (
            <>
              <Plus className="h-4 w-4" /> Invite
            </>
          )}
        </Button>
      </header>

      {inviting ? (
        <InviteForm stores={stores} onDone={() => setInviting(false)} />
      ) : null}

      {usersQ.isLoading ? (
        <div className="grid h-40 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : usersQ.isError ? (
        <ErrorState
          error={usersQ.error}
          onRetry={() => usersQ.refetch()}
          title="Couldn't load users"
        />
      ) : users.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="No users yet"
          body="Invite your first teammate to get them a sign-in link."
        />
      ) : (
        <ul className="divide-y divide-mist/50 overflow-hidden rounded-lg border border-mist/60 bg-paper">
          {users.map((u) => (
            <UserRow key={u.id} user={u} stores={stores} isSelf={u.id === me?.id} />
          ))}
        </ul>
      )}
    </div>
  );
}

function UserRow({
  user: u,
  stores,
  isSelf,
}: {
  user: UserDto;
  stores: StoreDto[];
  isSelf: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const update = useMutation({
    mutationFn: (body: Parameters<typeof api.adminUsers.update>[1]) =>
      api.adminUsers.update(u.id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['studio', 'admin-users'] });
      toast.success('User updated');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.adminUsers.remove(u.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['studio', 'admin-users'] });
      toast.success('User removed');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const busy = update.isPending || remove.isPending;

  const confirmRemove = () => {
    if (
      window.confirm(
        `Remove ${u.name || u.email}? This permanently deletes their account.`,
      )
    ) {
      remove.mutate();
    }
  };

  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-3 px-5 py-3',
        u.disabled && 'opacity-60',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">
          {u.name || u.email}
        </span>
        <span className="block truncate text-xs text-steel">{u.email}</span>
      </span>

      {u.disabled ? (
        <Badge variant="muted" className="text-fail">
          Disabled
        </Badge>
      ) : null}

      {/* Store assignment (managers + setup crew are pinned to one store) */}
      {u.role === 'STORE_MANAGER' || u.role === 'SETUP_CREW' ? (
        <select
          aria-label={`Store for ${u.email}`}
          value={u.storeId ?? ''}
          disabled={busy || isSelf}
          onChange={(e) =>
            update.mutate({ storeId: e.target.value || null })
          }
          className={fieldCls}
        >
          <option value="">No store</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      ) : null}

      {/* Role */}
      <select
        aria-label={`Role for ${u.email}`}
        value={u.role}
        disabled={busy || isSelf}
        onChange={(e) => update.mutate({ role: e.target.value as RoleStr })}
        className={fieldCls}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>

      {/* Activate / deactivate */}
      <Button
        size="sm"
        variant={u.disabled ? 'outline' : 'ghost'}
        disabled={busy || isSelf}
        onClick={() => update.mutate({ disabled: !u.disabled })}
        className={u.disabled ? '' : 'text-fail'}
      >
        {u.disabled ? 'Reactivate' : 'Deactivate'}
      </Button>

      {/* Permanent delete — confirmed; blocked for self (also enforced server-side) */}
      <Button
        size="sm"
        variant="ghost"
        disabled={busy || isSelf}
        onClick={confirmRemove}
        className="text-fail"
      >
        Remove
      </Button>
    </li>
  );
}

function InviteForm({
  stores,
  onDone,
}: {
  stores: StoreDto[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = React.useState('');
  const [name, setName] = React.useState('');
  const [role, setRole] = React.useState<RoleStr>('REVIEWER');
  const [storeId, setStoreId] = React.useState('');

  const invite = useMutation({
    mutationFn: () =>
      api.adminUsers.invite({
        email: email.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        role,
        ...((role === 'STORE_MANAGER' || role === 'SETUP_CREW') && storeId
          ? { storeId }
          : {}),
      }),
    onSuccess: (u) => {
      void qc.invalidateQueries({ queryKey: ['studio', 'admin-users'] });
      toast.success(`Invite sent to ${u.email}`);
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || invite.isPending) return;
    invite.mutate();
  };

  return (
    <form
      onSubmit={submit}
      className="mb-6 space-y-3 rounded-lg border border-mist/60 bg-surface/40 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-graphite">
            Email
          </span>
          <input
            autoFocus
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@grb.com"
            className={cn(fieldCls, 'w-full')}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-graphite">
            Name <span className="text-steel">(optional)</span>
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={cn(fieldCls, 'w-full')}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-graphite">
            Role
          </span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as RoleStr)}
            className={cn(fieldCls, 'w-full')}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        {role === 'STORE_MANAGER' || role === 'SETUP_CREW' ? (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-graphite">
              Store
            </span>
            <select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              className={cn(fieldCls, 'w-full')}
            >
              <option value="">No store</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!email.trim() || invite.isPending}>
          {invite.isPending ? 'Sending…' : 'Send invite'}
        </Button>
      </div>
    </form>
  );
}
