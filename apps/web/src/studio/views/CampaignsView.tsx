import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Layers, Plus } from 'lucide-react';
import { Badge, Button, Spinner, cn } from '@wally/ui';

import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { EmptyState, ErrorState } from '../../components/states';
import { useSetStudioTopBar } from '../components/StudioContext';

const STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'Active', cls: 'text-pass' },
  DRAFT: { label: 'Draft', cls: 'text-steel' },
  CLOSED: { label: 'Closed', cls: 'text-graphite' },
};

const fieldCls =
  'w-full rounded-md border border-mist/70 bg-paper px-3 py-2 text-sm text-ink transition-colors focus:border-graphite focus:outline-none';

/** Admin: campaign lifecycle — create, see status, promote one to active. */
export function CampaignsView() {
  const qc = useQueryClient();
  const toast = useToast();
  useSetStudioTopBar({ guideName: 'Campaigns', stores: [] });

  const campaignsQ = useQuery({
    queryKey: ['studio', 'campaigns'],
    queryFn: () => api.campaigns.list(),
  });
  const [creating, setCreating] = React.useState(false);

  const activate = useMutation({
    mutationFn: (id: string) => api.campaigns.activate(id),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['studio', 'campaigns'] });
      toast.success(`“${c.key}” is now the active campaign`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const campaigns = campaignsQ.data ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-brand text-steel">Admin</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
            Campaigns
          </h1>
          <p className="mt-1 text-sm text-steel">
            A campaign is one guide period (e.g. a sale). Only one is active at a
            time — promoting one closes the previous active campaign.
          </p>
        </div>
        <Button
          onClick={() => setCreating((v) => !v)}
          variant={creating ? 'outline' : undefined}
        >
          {creating ? (
            'Cancel'
          ) : (
            <>
              <Plus className="h-4 w-4" /> New campaign
            </>
          )}
        </Button>
      </header>

      {creating ? <CreateForm onDone={() => setCreating(false)} /> : null}

      {campaignsQ.isLoading ? (
        <div className="grid h-40 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : campaignsQ.isError ? (
        <ErrorState
          error={campaignsQ.error}
          onRetry={() => campaignsQ.refetch()}
          title="Couldn't load campaigns"
        />
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No campaigns yet"
          body="Create your first campaign, then set it active to start the guide."
        />
      ) : (
        <ul className="divide-y divide-mist/50 overflow-hidden rounded-lg border border-mist/60 bg-paper">
          {campaigns.map((c) => (
            <li key={c.id} className="flex items-center gap-4 px-5 py-3.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[15px] font-semibold text-ink">
                  {c.name}{' '}
                  <span className="font-normal text-steel">· {c.key}</span>
                </span>
                <span className="text-xs text-steel">
                  {c.storeCount} store{c.storeCount === 1 ? '' : 's'}
                </span>
              </span>
              <Badge
                variant="muted"
                className={cn('shrink-0', STATUS[c.status]?.cls)}
              >
                {STATUS[c.status]?.label ?? c.status}
              </Badge>
              {c.status === 'ACTIVE' ? (
                <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-pass">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Active
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={activate.isPending}
                  onClick={() => activate.mutate(c.id)}
                >
                  Set active
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [key, setKey] = React.useState('');
  const [name, setName] = React.useState('');
  const [startsAt, setStartsAt] = React.useState('');
  const [endsAt, setEndsAt] = React.useState('');

  const create = useMutation({
    mutationFn: () =>
      api.campaigns.create({
        key: key.trim(),
        name: name.trim(),
        ...(startsAt ? { startsAt } : {}),
        ...(endsAt ? { endsAt } : {}),
      }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['studio', 'campaigns'] });
      toast.success(`Campaign “${c.key}” created`);
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || !name.trim() || create.isPending) return;
    create.mutate();
  };

  return (
    <form
      onSubmit={submit}
      className="mb-6 space-y-3 rounded-lg border border-mist/60 bg-surface/40 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-graphite">
            Key
          </span>
          <input
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="MSP2-2026"
            maxLength={40}
            className={fieldCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-graphite">
            Name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Myer Stocktake Sale P2"
            maxLength={160}
            className={fieldCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-graphite">
            Starts <span className="text-steel">(optional)</span>
          </span>
          <input
            type="date"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className={fieldCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-graphite">
            Ends <span className="text-steel">(optional)</span>
          </span>
          <input
            type="date"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className={fieldCls}
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!key.trim() || !name.trim() || create.isPending}
        >
          {create.isPending ? 'Creating…' : 'Create campaign'}
        </Button>
      </div>
    </form>
  );
}
