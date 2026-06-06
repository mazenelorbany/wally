import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, FileText, Megaphone, Pin, Undo2 } from 'lucide-react';
import { Button, Card, Spinner } from '@wally/ui';
import type { BulletinDto } from '@wally/sdk';

import { api } from '../../lib/api';
import { useManagerStore } from '../ManagerStoreContext';

const fmtDate = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : null;

export function ManagerBulletinsView() {
  const { storeId } = useManagerStore();
  const qc = useQueryClient();

  const bulletinsQ = useQuery({
    queryKey: ['manager', 'bulletins', storeId],
    queryFn: () => api.bulletins.mine(storeId),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['manager', 'bulletins', storeId] });
    void qc.invalidateQueries({ queryKey: ['manager', 'home', storeId] });
  };
  const ack = useMutation({
    mutationFn: (id: string) => api.bulletins.acknowledge(id, storeId),
    onSuccess: invalidate,
  });
  const unack = useMutation({
    mutationFn: (id: string) => api.bulletins.unacknowledge(id, storeId),
    onSuccess: invalidate,
  });

  if (bulletinsQ.isLoading) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner className="text-2xl text-steel" />
      </div>
    );
  }
  const bulletins = bulletinsQ.data ?? [];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-ink">
          <Megaphone className="h-5 w-5 text-graphite" /> Bulletins
        </h1>
        <p className="mt-0.5 text-sm text-steel">
          What head office needs you to know for this sale.
        </p>
      </header>

      {bulletins.length === 0 ? (
        <div className="rounded-xl border border-mist/60 bg-surface/40 px-5 py-10 text-center">
          <Megaphone className="mx-auto h-7 w-7 text-mist" />
          <p className="mt-2 text-sm font-medium text-ink">No bulletins right now</p>
          <p className="mt-1 text-xs text-steel">You're up to date.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bulletins.map((b) => (
            <BulletinCard
              key={b.id}
              bulletin={b}
              acking={ack.isPending && ack.variables === b.id}
              unacking={unack.isPending && unack.variables === b.id}
              onAck={() => ack.mutate(b.id)}
              onUnack={() => unack.mutate(b.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BulletinCard({
  bulletin: b,
  acking,
  unacking,
  onAck,
  onUnack,
}: {
  bulletin: BulletinDto;
  acking: boolean;
  unacking: boolean;
  onAck: () => void;
  onUnack: () => void;
}) {
  return (
    <Card className={`p-5 ${b.acknowledged ? '' : 'border-signal/40'}`}>
      <div className="flex items-start gap-2">
        {b.pinned ? <Pin className="mt-1 h-3.5 w-3.5 shrink-0 text-gold-deep" /> : null}
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-semibold text-ink">{b.title}</h2>
          {b.startsAt || b.endsAt ? (
            <p className="mt-0.5 text-xs text-steel">
              {fmtDate(b.startsAt)}
              {b.endsAt ? ` – ${fmtDate(b.endsAt)}` : ''}
            </p>
          ) : null}
        </div>
        {b.acknowledged ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-pass">
            <CheckCircle2 className="h-3.5 w-3.5" /> Read
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-signal/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-brand text-signal">
            New
          </span>
        )}
      </div>

      {b.body ? (
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-graphite">
          {b.body}
        </p>
      ) : null}

      {b.attachmentUrl ? (
        <a
          href={b.attachmentUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-mist/70 bg-surface px-2.5 py-1.5 text-xs font-medium text-graphite hover:border-steel hover:text-ink"
        >
          <FileText className="h-3.5 w-3.5" /> {b.attachmentName ?? 'Attachment'}
        </a>
      ) : null}

      <div className="mt-4 border-t border-mist/40 pt-3">
        {!b.acknowledged ? (
          <Button size="sm" className="w-full" onClick={onAck} loading={acking}>
            <Check className="h-4 w-4" /> I've read this
          </Button>
        ) : (
          <button
            type="button"
            onClick={onUnack}
            disabled={unacking}
            className="inline-flex items-center gap-1.5 text-xs text-steel hover:text-ink disabled:opacity-60"
          >
            <Undo2 className="h-3.5 w-3.5" />
            {unacking ? 'Undoing…' : 'Acknowledged in error? Undo'}
          </button>
        )}
      </div>
    </Card>
  );
}
