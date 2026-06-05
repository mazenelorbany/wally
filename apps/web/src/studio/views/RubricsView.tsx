import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus, Trash2, X } from 'lucide-react';
import { Badge, Button, Spinner, cn } from '@wally/ui';
import type { Criterion, RollupRule, Rubric } from '@wally/types';

import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { EmptyState, ErrorState } from '../../components/states';
import { useSetStudioTopBar } from '../components/StudioContext';

const fieldCls =
  'rounded-md border border-mist/70 bg-paper px-2.5 py-1.5 text-sm text-ink focus:border-graphite focus:outline-none';

const DEFAULT_ROLLUP: RollupRule = {
  not_good_if_any_critical_fails: true,
  good_if_only_noncritical_fails: true,
};

type Draft = {
  fixtureKey: string;
  lockKey: boolean; // true when editing an existing fixture's rubric
  criteria: Criterion[];
  rollupRule: RollupRule;
};

/** Admin: author the grading rubric per fixture (append-only, versioned). */
export function RubricsView() {
  const qc = useQueryClient();
  const toast = useToast();
  useSetStudioTopBar({ guideName: 'Rubrics', stores: [] });

  const campaignsQ = useQuery({
    queryKey: ['studio', 'campaigns'],
    queryFn: () => api.campaigns.list(),
  });
  const campaign =
    campaignsQ.data?.find((c) => c.status === 'ACTIVE') ?? campaignsQ.data?.[0];

  const rubricsQ = useQuery({
    queryKey: ['studio', 'rubrics', campaign?.id],
    queryFn: () => api.rubrics.list(campaign!.id),
    enabled: Boolean(campaign?.id),
  });

  // Latest version per fixtureKey.
  const latest = React.useMemo(() => {
    const byKey = new Map<string, Rubric>();
    for (const r of rubricsQ.data ?? []) {
      const prev = byKey.get(r.fixtureKey);
      if (!prev || r.version > prev.version) byKey.set(r.fixtureKey, r);
    }
    return [...byKey.values()].sort((a, b) =>
      a.fixtureKey.localeCompare(b.fixtureKey),
    );
  }, [rubricsQ.data]);

  const [draft, setDraft] = React.useState<Draft | null>(null);

  const publish = useMutation({
    mutationFn: (d: Draft) =>
      api.rubrics.publish(campaign!.id, {
        fixtureKey: d.fixtureKey.trim(),
        criteria: d.criteria,
        rollupRule: d.rollupRule,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['studio', 'rubrics', campaign?.id] });
      toast.success(`Published ${r.fixtureKey} v${r.version}`);
      setDraft(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const startNew = () =>
    setDraft({
      fixtureKey: '',
      lockKey: false,
      criteria: [{ id: 'c1', kind: 'presence', critical: false, text: '' }],
      rollupRule: { ...DEFAULT_ROLLUP },
    });

  const startEdit = (r: Rubric) =>
    setDraft({
      fixtureKey: r.fixtureKey,
      lockKey: true,
      criteria: r.criteria.map((c) => ({ ...c })),
      rollupRule: { ...r.rollupRule },
    });

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-brand text-steel">Admin</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
            Rubrics{' '}
            {campaign ? <span className="text-steel">· {campaign.key}</span> : null}
          </h1>
          <p className="mt-1 text-sm text-steel">
            The grading standard the AI scores against, per fixture. Publishing
            appends a new version — it never edits a live rubric.
          </p>
        </div>
        {campaign ? (
          <Button onClick={startNew} disabled={Boolean(draft)}>
            <Plus className="h-4 w-4" /> New rubric
          </Button>
        ) : null}
      </header>

      {draft ? (
        <RubricEditor
          draft={draft}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onPublish={() => publish.mutate(draft)}
          publishing={publish.isPending}
        />
      ) : null}

      {campaignsQ.isLoading || rubricsQ.isLoading ? (
        <div className="grid h-40 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : !campaign ? (
        <p className="text-sm text-steel">Create a campaign first.</p>
      ) : rubricsQ.isError ? (
        <ErrorState
          error={rubricsQ.error}
          onRetry={() => rubricsQ.refetch()}
          title="Couldn't load rubrics"
        />
      ) : latest.length === 0 && !draft ? (
        <EmptyState
          icon={ClipboardList}
          title="No rubrics yet"
          body="Author a rubric per fixture so the AI has a standard to grade against."
        />
      ) : (
        <ul className="divide-y divide-mist/50 overflow-hidden rounded-lg border border-mist/60 bg-paper">
          {latest.map((r) => (
            <li
              key={r.fixtureKey}
              className="flex items-center gap-3 px-5 py-3.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[15px] font-semibold text-ink">
                  {r.fixtureKey}
                </span>
                <span className="text-xs text-steel">
                  {r.criteria.length} criterion
                  {r.criteria.length === 1 ? '' : 'a'} ·{' '}
                  {r.criteria.filter((c) => c.critical).length} critical
                </span>
              </span>
              <Badge variant="muted">v{r.version}</Badge>
              <Button variant="outline" size="sm" onClick={() => startEdit(r)}>
                Edit → new version
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RubricEditor({
  draft,
  onChange,
  onCancel,
  onPublish,
  publishing,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onCancel: () => void;
  onPublish: () => void;
  publishing: boolean;
}) {
  const setCriterion = (i: number, patch: Partial<Criterion>) =>
    onChange({
      ...draft,
      criteria: draft.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    });

  const addCriterion = () => {
    const used = new Set(draft.criteria.map((c) => c.id));
    let n = draft.criteria.length + 1;
    while (used.has(`c${n}`)) n += 1;
    onChange({
      ...draft,
      criteria: [
        ...draft.criteria,
        { id: `c${n}`, kind: 'presence', critical: false, text: '' },
      ],
    });
  };

  const removeCriterion = (i: number) =>
    onChange({ ...draft, criteria: draft.criteria.filter((_, j) => j !== i) });

  const valid =
    draft.fixtureKey.trim().length > 0 &&
    draft.criteria.length > 0 &&
    draft.criteria.every((c) => c.id.trim() && c.text.trim());

  return (
    <div className="mb-6 rounded-lg border border-mist/60 bg-surface/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-graphite">
            Fixture key
          </span>
          <input
            value={draft.fixtureKey}
            disabled={draft.lockKey}
            onChange={(e) =>
              onChange({ ...draft, fixtureKey: e.target.value })
            }
            placeholder="storefront"
            className={cn(fieldCls, 'w-48 disabled:opacity-60')}
          />
        </label>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close editor"
          className="rounded-md p-1.5 text-steel hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-brand text-steel">
        Criteria
      </p>
      <div className="flex flex-col gap-2">
        {draft.criteria.map((c, i) => (
          <div
            key={i}
            className="flex flex-wrap items-center gap-2 rounded-md border border-mist/60 bg-paper p-2"
          >
            <input
              value={c.id}
              onChange={(e) => setCriterion(i, { id: e.target.value })}
              placeholder="id"
              aria-label="Criterion id"
              className={cn(fieldCls, 'w-20')}
            />
            <input
              value={c.text}
              onChange={(e) => setCriterion(i, { text: e.target.value })}
              placeholder="What good looks like…"
              aria-label="Criterion text"
              className={cn(fieldCls, 'min-w-0 flex-1')}
            />
            <select
              value={c.kind}
              onChange={(e) =>
                setCriterion(i, {
                  kind: e.target.value as Criterion['kind'],
                })
              }
              aria-label="Criterion kind"
              className={fieldCls}
            >
              <option value="presence">Presence</option>
              <option value="aesthetic">Aesthetic</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-graphite">
              <input
                type="checkbox"
                checked={c.critical}
                onChange={(e) =>
                  setCriterion(i, { critical: e.target.checked })
                }
              />
              Critical
            </label>
            <button
              type="button"
              onClick={() => removeCriterion(i)}
              disabled={draft.criteria.length === 1}
              aria-label="Remove criterion"
              className="rounded-md p-1.5 text-steel hover:text-fail disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <Button variant="ghost" size="sm" className="mt-2" onClick={addCriterion}>
        <Plus className="h-3.5 w-3.5" /> Add criterion
      </Button>

      <p className="mb-1.5 mt-4 text-[11px] font-medium uppercase tracking-brand text-steel">
        Roll-up rule
      </p>
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-sm text-graphite">
          <input
            type="checkbox"
            checked={draft.rollupRule.not_good_if_any_critical_fails}
            onChange={(e) =>
              onChange({
                ...draft,
                rollupRule: {
                  ...draft.rollupRule,
                  not_good_if_any_critical_fails: e.target.checked,
                },
              })
            }
          />
          A failed <b className="font-semibold text-ink">critical</b> criterion
          fails the whole fixture
        </label>
        <label className="flex items-center gap-2 text-sm text-graphite">
          <input
            type="checkbox"
            checked={draft.rollupRule.good_if_only_noncritical_fails}
            onChange={(e) =>
              onChange({
                ...draft,
                rollupRule: {
                  ...draft.rollupRule,
                  good_if_only_noncritical_fails: e.target.checked,
                },
              })
            }
          />
          Only non-critical fails still counts as <b className="font-semibold text-ink">good</b>
        </label>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onPublish} disabled={!valid || publishing}>
          {publishing ? 'Publishing…' : 'Publish version'}
        </Button>
      </div>
    </div>
  );
}
