import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardList,
  History,
  ImageOff,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Badge, Button, Spinner, cn } from '@wally/ui';
import type { Criterion, RollupRule, Rubric } from '@wally/types';

import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { EmptyState, ErrorState } from '../../components/states';
import { useSetStudioTopBar } from '../components/StudioContext';
import { useProjectCampaign } from '../lib/useProjectCampaign';

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
  // The reference/standard image the scorer compares against. `undefined` means
  // "unchanged" → publish omits it and the server carries the prior version's key
  // forward; `null` clears it; a string sets/replaces it. `referenceUrl` is the
  // signed preview of whatever is currently in effect.
  referenceKey?: string | null;
  referenceUrl?: string | null;
};

/** Admin: author the grading rubric per fixture (append-only, versioned). */
export function RubricsView() {
  const qc = useQueryClient();
  const toast = useToast();
  useSetStudioTopBar({ guideName: 'Rubrics', stores: [] });

  // Scope to the SELECTED project's campaign, not the org-wide newest-active.
  const { campaign, campaignsQ } = useProjectCampaign();

  const rubricsQ = useQuery({
    queryKey: ['studio', 'rubrics', campaign?.id],
    queryFn: () => api.rubrics.list(campaign!.id),
    enabled: Boolean(campaign?.id),
  });

  // All versions grouped per fixtureKey (newest first), plus the latest row for
  // the collapsed summary line.
  const groups = React.useMemo(() => {
    const byKey = new Map<string, Rubric[]>();
    for (const r of rubricsQ.data ?? []) {
      const list = byKey.get(r.fixtureKey) ?? [];
      list.push(r);
      byKey.set(r.fixtureKey, list);
    }
    return [...byKey.entries()]
      .map(([fixtureKey, versions]) => ({
        fixtureKey,
        versions: [...versions].sort((a, b) => b.version - a.version),
      }))
      .sort((a, b) => a.fixtureKey.localeCompare(b.fixtureKey));
  }, [rubricsQ.data]);

  const [draft, setDraft] = React.useState<Draft | null>(null);

  const activate = useMutation({
    mutationFn: (vars: { fixtureKey: string; version: number }) =>
      api.rubrics.activate(campaign!.id, vars.fixtureKey, vars.version),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['studio', 'rubrics', campaign?.id] });
      toast.success(`Activated ${r.fixtureKey} v${r.version}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const publish = useMutation({
    mutationFn: (d: Draft) =>
      api.rubrics.publish(campaign!.id, {
        fixtureKey: d.fixtureKey.trim(),
        criteria: d.criteria,
        rollupRule: d.rollupRule,
        // Only send referenceKey when the author touched it; otherwise the server
        // carries the previous version's reference forward (never silently drops).
        ...(d.referenceKey !== undefined ? { referenceKey: d.referenceKey } : {}),
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
      referenceKey: undefined,
      referenceUrl: null,
    });

  const startEdit = (r: Rubric) =>
    setDraft({
      fixtureKey: r.fixtureKey,
      lockKey: true,
      criteria: r.criteria.map((c) => ({ ...c })),
      rollupRule: { ...r.rollupRule },
      // Carry the current version's reference into the draft so an edit keeps it
      // (and the preview shows what's in effect). `undefined` key = unchanged.
      referenceKey: undefined,
      referenceUrl: r.referenceUrl ?? null,
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

      {draft && campaign ? (
        <RubricEditor
          campaignId={campaign.id}
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
      ) : groups.length === 0 && !draft ? (
        <EmptyState
          icon={ClipboardList}
          title="No rubrics yet"
          body="Author a rubric per fixture so the AI has a standard to grade against."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.map((g) => (
            <RubricCard
              key={g.fixtureKey}
              versions={g.versions}
              onEdit={startEdit}
              onActivate={(version) =>
                activate.mutate({ fixtureKey: g.fixtureKey, version })
              }
              activating={activate.isPending}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One fixture's rubric: a summary line for the live version + an expandable
 * version history. The "live" version is the one flagged active, falling back to
 * the highest version when none is flagged (legacy rows) — mirrors the scorer.
 */
function RubricCard({
  versions,
  onEdit,
  onActivate,
  activating,
}: {
  versions: Rubric[]; // newest first
  onEdit: (r: Rubric) => void;
  onActivate: (version: number) => void;
  activating: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  // versions is sorted newest-first; the highest version is index 0.
  const live = versions.find((v) => v.active) ?? versions[0];
  if (!live) return null; // never (groups only hold non-empty version lists)
  const fixtureKey = live.fixtureKey;
  const hasHistory = versions.length > 1;

  return (
    <li className="overflow-hidden rounded-lg border border-mist/60 bg-paper">
      <div className="flex items-center gap-3 px-5 py-3.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[15px] font-semibold text-ink">
            {fixtureKey}
          </span>
          <span className="text-xs text-steel">
            {live.criteria.length} criterion
            {live.criteria.length === 1 ? '' : 'a'} ·{' '}
            {live.criteria.filter((c) => c.critical).length} critical
            {live.referenceKey ? ' · reference set' : ' · no reference'}
          </span>
        </span>
        <Badge variant="muted">live v{live.version}</Badge>
        {hasHistory ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            <History className="h-3.5 w-3.5" />
            {versions.length} versions
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => onEdit(live)}>
          Edit → new version
        </Button>
      </div>

      {open && hasHistory ? (
        <ul className="divide-y divide-mist/40 border-t border-mist/50 bg-surface/30">
          {versions.map((v) => {
            const isLive = v.version === live.version;
            return (
              <li
                key={v.id}
                className="flex items-center gap-3 px-5 py-2.5 text-sm"
              >
                <span className="font-medium tabular-nums text-ink">
                  v{v.version}
                </span>
                {isLive ? (
                  <Badge variant="pass">Active</Badge>
                ) : (
                  <span className="text-xs text-steel">
                    {v.criteria.length} criteria
                    {v.referenceKey ? ' · reference' : ''}
                  </span>
                )}
                <span className="flex-1" />
                {!isLive ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={activating}
                    onClick={() => onActivate(v.version)}
                  >
                    Activate
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

function RubricEditor({
  campaignId,
  draft,
  onChange,
  onCancel,
  onPublish,
  publishing,
}: {
  campaignId: string;
  draft: Draft;
  onChange: (d: Draft) => void;
  onCancel: () => void;
  onPublish: () => void;
  publishing: boolean;
}) {
  const toast = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  // IDs are model-facing plumbing — hidden by default, revealed for power edits.
  const [showIds, setShowIds] = React.useState(false);

  // Upload a reference image → set the draft's referenceKey + preview URL.
  const upload = useMutation({
    mutationFn: (file: File) =>
      api.rubrics.uploadReferenceImage(campaignId, file),
    onSuccess: (res) => {
      onChange({ ...draft, referenceKey: res.referenceKey, referenceUrl: res.url });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onPickReference = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) upload.mutate(file);
  };

  // Explicitly clear the reference (publish sends referenceKey: null).
  const clearReference = () =>
    onChange({ ...draft, referenceKey: null, referenceUrl: null });

  const setCriterion = (i: number, patch: Partial<Criterion>) =>
    onChange({
      ...draft,
      criteria: draft.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    });

  // New criteria land in the group their "Add" button belongs to (critical =
  // must-pass). The id is auto-generated plumbing the author rarely touches —
  // editable via the "Show IDs" toggle, not surfaced by default.
  const addCriterion = (critical: boolean) => {
    const used = new Set(draft.criteria.map((c) => c.id));
    let n = draft.criteria.length + 1;
    while (used.has(`c${n}`)) n += 1;
    onChange({
      ...draft,
      criteria: [
        ...draft.criteria,
        { id: `c${n}`, kind: 'presence', critical, text: '' },
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

      {(() => {
        // Group is derived from `critical` — the same flag the scorer rolls up.
        // We map over the real array first so each row keeps its true index for
        // setCriterion/removeCriterion regardless of which group it renders in.
        const rows = draft.criteria.map((c, i) => ({ c, i }));
        const mustPass = rows.filter((r) => r.c.critical);
        const quality = rows.filter((r) => !r.c.critical);
        const onlyOne = draft.criteria.length === 1;

        const renderRow = ({ c, i }: { c: Criterion; i: number }) => (
          <div
            key={i}
            className={cn(
              'rounded-md border border-mist/60 bg-paper p-3',
              // Must-pass carries the one signal accent — red = stop, the exact
              // semantic of a critical criterion (fail it → the fixture fails).
              c.critical && 'border-l-2 border-l-signal/60',
            )}
          >
            <textarea
              value={c.text}
              onChange={(e) => setCriterion(i, { text: e.target.value })}
              placeholder="Describe what good looks like…"
              aria-label="Criterion description"
              rows={2}
              className={cn(fieldCls, 'block w-full resize-y leading-snug')}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="inline-flex overflow-hidden rounded-md border border-mist/70">
                {(['presence', 'aesthetic'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setCriterion(i, { kind: k })}
                    aria-pressed={c.kind === k}
                    className={cn(
                      'px-2.5 py-1 text-xs capitalize transition-colors',
                      c.kind === k
                        ? 'bg-ink text-paper'
                        : 'text-steel hover:bg-surface',
                    )}
                  >
                    {k}
                  </button>
                ))}
              </div>
              {showIds ? (
                <input
                  value={c.id}
                  onChange={(e) => setCriterion(i, { id: e.target.value })}
                  placeholder="id"
                  aria-label="Criterion id"
                  className={cn(fieldCls, 'w-28 font-mono text-xs')}
                />
              ) : null}
              <span className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCriterion(i, { critical: !c.critical })}
              >
                {c.critical ? 'Make optional' : 'Make must-pass'}
              </Button>
              <button
                type="button"
                onClick={() => removeCriterion(i)}
                disabled={onlyOne}
                aria-label="Remove criterion"
                className="rounded-md p-1.5 text-steel hover:text-fail disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        );

        const emptyHint = (text: string) => (
          <p className="rounded-md border border-dashed border-mist/70 px-3 py-2 text-xs text-steel">
            {text}
          </p>
        );

        return (
          <>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-brand text-steel">
                Criteria
              </p>
              <button
                type="button"
                onClick={() => setShowIds((v) => !v)}
                className="text-[11px] text-steel underline-offset-2 hover:text-ink hover:underline"
              >
                {showIds ? 'Hide IDs' : 'Show IDs'}
              </button>
            </div>

            <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-xs font-semibold text-ink">
              Must pass
              <span className="font-normal text-steel">
                fail any of these → the fixture fails
              </span>
            </p>
            <div className="flex flex-col gap-2">
              {mustPass.length
                ? mustPass.map(renderRow)
                : emptyHint('No must-pass criteria yet.')}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => addCriterion(true)}
            >
              <Plus className="h-3.5 w-3.5" /> Add must-pass
            </Button>

            <p className="mb-1.5 mt-5 flex flex-wrap items-baseline gap-x-2 text-xs font-semibold text-ink">
              Quality
              <span className="font-normal text-steel">
                won't fail the fixture on its own
              </span>
            </p>
            <div className="flex flex-col gap-2">
              {quality.length
                ? quality.map(renderRow)
                : emptyHint('No quality criteria yet.')}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => addCriterion(false)}
            >
              <Plus className="h-3.5 w-3.5" /> Add quality criterion
            </Button>
          </>
        );
      })()}

      {/* Reference / standard image — what the AI compares photos against */}
      <p className="mb-1.5 mt-4 text-[11px] font-medium uppercase tracking-brand text-steel">
        Reference image
      </p>
      <div className="flex items-center gap-3 rounded-md border border-mist/60 bg-paper p-2.5">
        {draft.referenceUrl ? (
          <img
            src={draft.referenceUrl}
            alt="Rubric reference"
            className="h-16 w-16 shrink-0 rounded object-cover"
          />
        ) : (
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded border border-dashed border-mist text-steel">
            <ImageOff className="h-5 w-5" aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-graphite">
            {draft.referenceUrl
              ? 'The AI compares photos against this image plus the criteria.'
              : draft.referenceKey === null
                ? 'Reference will be cleared on publish — the AI grades against the criteria text only.'
                : 'No reference set — the AI grades against the criteria text only.'}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={upload.isPending}
            >
              <Upload className="h-3.5 w-3.5" />
              {upload.isPending
                ? 'Uploading…'
                : draft.referenceUrl
                  ? 'Replace'
                  : 'Upload reference'}
            </Button>
            {draft.referenceUrl ? (
              <Button variant="ghost" size="sm" onClick={clearReference}>
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </Button>
            ) : null}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={onPickReference}
        />
      </div>

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
