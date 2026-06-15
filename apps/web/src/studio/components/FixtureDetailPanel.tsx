import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Badge, Button, cn, Spinner } from '@wally/ui';
import type { GuideChecklistItem, GuideFixtureExampleImage } from '@wally/types';

import { ErrorState } from '../../components/states';
import { errorMessage } from '../../lib/api';
import { studio } from '../lib/sdk';
import { useToast } from '../../lib/toast';
import {
  useAddExampleImage,
  useAddMerchandise,
  useFixtureProducts,
  useGuideFixture,
  usePrepopulate,
  useProducts,
  useRemoveExampleImage,
  useRemoveMerchandise,
  useReorderPlanogram,
  useSaveNotes,
  useSetExampleImageBestInClass,
  useUpdateExampleImageCaption,
} from '../lib/hooks';
import { fixtureKindMeta } from '../lib/fixtureKind';
import { ProductThumb } from './ProductThumb';
import { PlanogramEditor } from './PlanogramEditor';

/**
 * The fixture instruction sheet — opened in a roomy dialog by clicking a box
 * on the floor plan. Two columns (notes + instructions | example images +
 * checklist) with the merchandise planogram full-width underneath.
 */
export function FixtureDetailPanel({
  campaignId,
  fixtureId,
  onClose,
}: {
  campaignId: string;
  fixtureId: string;
  onClose: () => void;
}) {
  const detailQ = useGuideFixture(campaignId, fixtureId);
  const saveNotes = useSaveNotes(campaignId, fixtureId);
  const detail = detailQ.data;

  // Local draft so typing is smooth; we persist on blur (only if changed).
  const [draft, setDraft] = React.useState('');
  const lastSavedRef = React.useRef('');
  React.useEffect(() => {
    if (detail) {
      setDraft(detail.notes);
      lastSavedRef.current = detail.notes;
    }
  }, [detail]);

  const commitNotes = () => {
    if (!detail) return;
    if (draft === lastSavedRef.current) return;
    lastSavedRef.current = draft;
    // Address the GuideFixture by its own id (not the floor-plan fixture id).
    saveNotes.mutate({ id: detail.guideFixtureId, notes: draft });
  };

  const meta = detail ? fixtureKindMeta(detail.kind) : null;
  const KindIcon = meta?.icon;

  return (
    <aside
      aria-label="Fixture instructions"
      className="flex h-full w-full flex-col bg-paper"
    >
      {/* Header */}
      <header className="flex items-start justify-between gap-3 border-b border-mist/60 px-5 py-4">
        <div className="min-w-0">
          {detail ? (
            <>
              <div className="flex items-center gap-2">
                {KindIcon ? (
                  <KindIcon className="h-4 w-4 text-graphite" aria-hidden="true" />
                ) : null}
                <Badge variant="muted" className="uppercase tracking-brand">
                  {meta?.label}
                </Badge>
              </div>
              <h2 className="mt-1.5 truncate font-display text-lg font-semibold tracking-tight text-ink">
                {detail.fixtureName}
              </h2>
            </>
          ) : (
            <div className="h-9 w-40 animate-pulse rounded-md bg-mist/30" />
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close panel"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {detailQ.isLoading ? (
          <div className="grid place-items-center py-16">
            <Spinner className="text-2xl text-steel" />
          </div>
        ) : detailQ.isError ? (
          <ErrorState
            error={detailQ.error}
            onRetry={() => detailQ.refetch()}
            title="Could not load this fixture"
          />
        ) : detail ? (
          <div className="grid grid-cols-1 gap-x-8 gap-y-7 lg:grid-cols-2">
            {/* Left column — the written brief */}
            <div className="flex min-w-0 flex-col gap-7">
              {/* Notes */}
              <section>
                <SectionLabel
                  text="VM notes"
                  hint={
                    saveNotes.isPending
                      ? 'Saving…'
                      : saveNotes.isError
                        ? 'Save failed'
                        : 'Saved on blur'
                  }
                  tone={saveNotes.isError ? 'signal' : 'neutral'}
                />
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitNotes}
                  rows={6}
                  placeholder="How should this fixture be merchandised? Facings, hero SKUs, signage, do's and don'ts…"
                  className="w-full resize-y rounded-md border border-mist bg-surface/40 px-3 py-2.5 font-sans text-sm leading-relaxed text-ink placeholder:text-steel focus-visible:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
                />
              </section>

              {/* Instructions — ordered setup steps (separate from notes) */}
              <InstructionsSection
                campaignId={campaignId}
                fixtureId={fixtureId}
                guideFixtureId={detail.guideFixtureId}
                steps={detail.instructions}
              />
            </div>

            {/* Right column — the visual reference + report checklist */}
            <div className="flex min-w-0 flex-col gap-7">
              {/* Example images — "what good looks like" */}
              <ExampleImagesSection
                campaignId={campaignId}
                fixtureId={fixtureId}
                guideFixtureId={detail.guideFixtureId}
                images={detail.exampleImages}
              />

              {/* Checklist — the manager ticks these while filling the report */}
              <ChecklistSection
                campaignId={campaignId}
                fixtureId={fixtureId}
                guideFixtureId={detail.guideFixtureId}
                items={detail.checklist}
              />
            </div>

            {/* Merchandise planogram — shelves read left-to-right, so it gets
                the full dialog width below the two columns. */}
            <div className="min-w-0 lg:col-span-2">
              <MerchandiseSection
                campaignId={campaignId}
                fixtureId={fixtureId}
                guideFixtureId={detail.guideFixtureId}
                merchandise={detail.merchandise}
              />
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

const ACCEPT_IMAGE = 'image/jpeg,image/png,image/webp';

/**
 * The "what good looks like" reference grid with full authoring: upload a new
 * image (optional caption), edit a caption, star one best-in-class, and delete.
 * Without a reference the AI scores against the notes alone — so the empty state
 * says exactly that instead of a soft "no images yet".
 */
function ExampleImagesSection({
  campaignId,
  fixtureId,
  guideFixtureId,
  images,
}: {
  campaignId: string;
  fixtureId: string;
  guideFixtureId: string;
  images: GuideFixtureExampleImage[];
}) {
  const toast = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const add = useAddExampleImage(campaignId, fixtureId);
  const updateCaption = useUpdateExampleImageCaption(campaignId, fixtureId);
  const setBest = useSetExampleImageBestInClass(campaignId, fixtureId);
  const remove = useRemoveExampleImage(campaignId, fixtureId);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = React.useState('');

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    add.mutate(
      { guideFixtureId, file },
      {
        onSuccess: () => toast.success('Reference image added'),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  const startEditCaption = (img: GuideFixtureExampleImage) => {
    setEditingId(img.id);
    setCaptionDraft(img.caption ?? '');
  };

  const commitCaption = (imageId: string) => {
    updateCaption.mutate(
      { guideFixtureId, imageId, caption: captionDraft },
      { onError: (err) => toast.error(errorMessage(err)) },
    );
    setEditingId(null);
  };

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-brand text-steel">
          What good looks like{images.length ? ` · ${images.length}` : ''}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={add.isPending}
        >
          <Upload className="h-3.5 w-3.5" />
          {add.isPending ? 'Uploading…' : 'Add image'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT_IMAGE}
          className="sr-only"
          onChange={onPick}
        />
      </div>

      {images.length > 0 ? (
        <div className="grid grid-cols-2 gap-2.5">
          {images.map((img) => {
            const editing = editingId === img.id;
            return (
              <figure
                key={img.id}
                className="group overflow-hidden rounded-md border border-mist/60 bg-surface"
              >
                <div className="relative aspect-[4/3]">
                  <img
                    src={img.url}
                    alt={img.caption ?? 'Reference image'}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  {img.bestInClass ? (
                    <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-md bg-ink/85 px-1.5 py-0.5 text-[10px] font-medium text-paper">
                      <Star className="h-3 w-3 fill-paper" aria-hidden="true" />
                      Best in class
                    </span>
                  ) : null}
                  {/* Hover controls: star (best-in-class), edit caption, delete */}
                  <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {!img.bestInClass ? (
                      <IconAction
                        label="Mark best in class"
                        disabled={setBest.isPending}
                        onClick={() =>
                          setBest.mutate(
                            { guideFixtureId, imageId: img.id },
                            { onError: (e) => toast.error(errorMessage(e)) },
                          )
                        }
                      >
                        <Star className="h-3.5 w-3.5" />
                      </IconAction>
                    ) : null}
                    <IconAction
                      label="Edit caption"
                      onClick={() => startEditCaption(img)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </IconAction>
                    <IconAction
                      label="Delete image"
                      danger
                      disabled={remove.isPending}
                      onClick={() =>
                        remove.mutate(
                          { guideFixtureId, imageId: img.id },
                          { onError: (e) => toast.error(errorMessage(e)) },
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconAction>
                  </div>
                </div>
                {editing ? (
                  <div className="flex items-center gap-1 p-1.5">
                    <input
                      autoFocus
                      value={captionDraft}
                      onChange={(e) => setCaptionDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitCaption(img.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onBlur={() => commitCaption(img.id)}
                      placeholder="Add a caption…"
                      maxLength={280}
                      aria-label="Caption"
                      className="min-w-0 flex-1 rounded border border-mist bg-paper px-1.5 py-1 text-[11px] text-ink focus:border-steel focus:outline-none"
                    />
                  </div>
                ) : img.caption ? (
                  <figcaption className="px-2 py-1.5 text-[11px] leading-snug text-steel">
                    {img.caption}
                  </figcaption>
                ) : null}
              </figure>
            );
          })}
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-md border border-dashed border-signal/40 bg-signal/5 px-3 py-3 text-xs text-graphite">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-signal"
            aria-hidden="true"
          />
          <span>
            No reference image set — the AI will score this fixture against the{' '}
            <b className="font-semibold text-ink">notes only</b>. Add a “what good
            looks like” photo so it has a standard to compare against.
          </span>
        </div>
      )}
    </section>
  );
}

/** A small overlaid icon button used by the example-image hover controls. */
function IconAction({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid h-6 w-6 place-items-center rounded bg-paper/90 text-steel shadow-card transition-colors hover:text-ink disabled:opacity-40',
        danger && 'hover:text-signal',
      )}
    >
      {children}
    </button>
  );
}

/**
 * The merchandise planogram for a fixture, with a search-driven product picker
 * to add SKUs and a remove control on each placed product. Adds/removes hit the
 * guide-fixture merchandise endpoints and re-read the sheet.
 */
function MerchandiseSection({
  campaignId,
  fixtureId,
  guideFixtureId,
  merchandise,
}: {
  campaignId: string;
  fixtureId: string;
  guideFixtureId: string;
  merchandise: import('@wally/types').MerchandiseRow[];
}) {
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [q, setQ] = React.useState('');
  const add = useAddMerchandise(campaignId, fixtureId);
  const remove = useRemoveMerchandise(campaignId, fixtureId);
  const reorder = useReorderPlanogram(campaignId, fixtureId);
  // Pre-populate: this fixture's default product set + the copy action.
  const defaultsQ = useFixtureProducts(fixtureId);
  const defaultsCount = defaultsQ.data?.length ?? 0;
  const prepopulate = usePrepopulate(campaignId, fixtureId);

  // The catalog, filtered server-side as the user types.
  const productsQ = useProducts(adding ? { search: q } : {});
  const placedIds = new Set(
    merchandise.flatMap((r) => r.products.map((p) => p.id)),
  );
  const results = (productsQ.data ?? []).slice(0, 24);

  const total = merchandise.reduce((n, r) => n + r.products.length, 0);

  // Drag-and-drop layout editor — inline in this sheet (the sheet itself is the
  // popup), so notes + references + planogram all live in one place.
  if (editing) {
    return (
      <section>
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-medium uppercase tracking-brand text-steel">
            Merchandise{total ? ` · ${total}` : ''}
          </h3>
          <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
            Done
          </Button>
        </div>
        <PlanogramEditor
          large
          onDone={() => setEditing(false)}
          adapter={{
            rows: merchandise,
            isPersisting: reorder.isPending,
            onReorder: (body) => reorder.mutate({ guideFixtureId, body }),
            onAddProduct: (productId, row, onSuccess) =>
              add.mutate({ guideFixtureId, productId, row }, { onSuccess }),
            onRemoveFacing: (merchandiseId) =>
              remove.mutate({ guideFixtureId, merchandiseId }),
          }}
        />
      </section>
    );
  }

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-brand text-steel">
          Merchandise{total ? ` · ${total}` : ''}
        </h3>
        <div className="flex items-center gap-1.5">
          {!adding && total > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Edit layout
            </Button>
          ) : null}
          <Button
            variant={adding ? 'outline' : 'ghost'}
            size="sm"
            onClick={() => setAdding((v) => !v)}
          >
            {adding ? (
              <>
                <X className="h-3.5 w-3.5" /> Done
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" /> Add products
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Product picker */}
      {adding ? (
        <div className="mb-4 rounded-md border border-mist/70 bg-surface/40 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-steel" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search the catalog by name, brand or SKU…"
              className="w-full rounded-md border border-mist bg-paper py-2 pl-8 pr-3 text-sm text-ink placeholder:text-steel focus:border-steel focus:outline-none"
            />
          </div>
          <div className="mt-2 max-h-72 overflow-y-auto">
            {productsQ.isLoading ? (
              <div className="grid place-items-center py-6">
                <Spinner className="text-lg text-steel" />
              </div>
            ) : results.length === 0 ? (
              <p className="px-1 py-4 text-center text-xs text-steel">
                No products match.
              </p>
            ) : (
              <ul className="flex flex-col">
                {results.map((p) => {
                  const placed = placedIds.has(p.id);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={placed || add.isPending}
                        onClick={() =>
                          add.mutate({ guideFixtureId, productId: p.id })
                        }
                        className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-paper disabled:opacity-50"
                      >
                        <ProductThumb
                          imageUrl={p.imageUrl}
                          sku={p.sku}
                          name={p.name}
                          className="h-9 w-9 shrink-0 rounded"
                        />
                        <div className="min-w-0 flex-1 leading-tight">
                          <p className="truncate text-xs font-medium text-ink">
                            {p.name}
                          </p>
                          <p className="truncate text-[10px] uppercase tracking-brand text-steel">
                            {p.sku}
                            {p.brand ? ` · ${p.brand}` : ''}
                          </p>
                        </div>
                        {placed ? (
                          <span className="shrink-0 text-[10px] font-medium uppercase tracking-brand text-pass">
                            Added
                          </span>
                        ) : (
                          <Plus className="h-4 w-4 shrink-0 text-steel" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {/* Pre-populate from the fixture's default set — only when empty */}
      {!adding && total === 0 && defaultsCount > 0 ? (
        <div className="mb-4 rounded-md border border-mist/70 bg-surface/40 p-3">
          <p className="text-xs text-graphite">
            This fixture has <b className="text-ink">{defaultsCount}</b> default
            product{defaultsCount === 1 ? '' : 's'}. Start from them, or build
            the sheet yourself.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => prepopulate.mutate()}
              disabled={prepopulate.isPending}
            >
              {prepopulate.isPending
                ? 'Adding…'
                : `Pre-populate from defaults (${defaultsCount})`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
              Start from scratch
            </Button>
          </div>
          {prepopulate.isError ? (
            <p className="mt-1.5 text-xs text-fail">
              {errorMessage(prepopulate.error)}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Placed products — a shelf-by-shelf planogram (top → bottom) */}
      {merchandise.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-mist bg-paper">
          <div className="flex items-center justify-between border-b border-mist/70 bg-surface/50 px-3 py-2">
            <span className="text-[11px] font-medium uppercase tracking-brand text-steel">
              Planogram
            </span>
            <span className="text-[11px] tabular-nums text-steel">
              {total} facing{total === 1 ? '' : 's'} ·{' '}
              {merchandise.length} {merchandise.length === 1 ? 'shelf' : 'shelves'}
            </span>
          </div>
          {[...merchandise]
            .sort((a, b) => shelfRank(a.row) - shelfRank(b.row))
            .map((row) => (
              <div key={row.row} className="border-b border-mist/40 last:border-b-0">
                <div className="flex items-center justify-between px-3 pt-2">
                  <span className="text-[10px] font-semibold uppercase tracking-brand text-graphite">
                    {row.row}
                  </span>
                  <span className="text-[10px] tabular-nums text-steel">
                    {row.products.length} facing{row.products.length === 1 ? '' : 's'}
                  </span>
                </div>
                {/* The shelf: products laid out left-to-right, sitting on a baseline */}
                <div className="flex items-end gap-2 overflow-x-auto px-3 pb-1 pt-1.5">
                  {row.products.map((p) => (
                    <article
                      key={p.merchandiseId}
                      className="group relative w-14 shrink-0"
                      title={`${p.name} · ${p.sku}`}
                    >
                      <ProductThumb
                        imageUrl={p.imageUrl}
                        sku={p.sku}
                        name={p.name}
                        className="aspect-square w-14 rounded"
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${p.name}`}
                        onClick={() =>
                          remove.mutate({
                            guideFixtureId,
                            merchandiseId: p.merchandiseId,
                          })
                        }
                        className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-paper text-steel opacity-0 shadow-card transition-opacity hover:text-signal group-hover:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                      <p className="mt-0.5 truncate text-[9px] leading-tight text-steel">
                        {p.name}
                      </p>
                    </article>
                  ))}
                </div>
                {/* Shelf edge */}
                <div className="mx-3 mb-2 h-1 rounded-full bg-graphite/15" />
              </div>
            ))}
        </div>
      ) : defaultsCount === 0 ? (
        <EmptyHint text="No products placed yet — use “Add products”." />
      ) : null}
    </section>
  );
}

// Order shelves the way a bay reads top → bottom, from common shelf names.
// Unknown labels keep their data order (slotted in the middle).
function shelfRank(label: string): number {
  const l = label.toLowerCase();
  if (l.includes('top')) return 0;
  if (l.includes('upper')) return 1;
  if (l.includes('eye')) return 2;
  if (l.includes('mid')) return 3;
  if (l.includes('lower')) return 5;
  if (l.includes('bottom') || l.includes('base') || l.includes('floor')) return 6;
  return 4;
}

function SectionLabel({
  text,
  hint,
  tone = 'neutral',
}: {
  text: string;
  hint?: string;
  tone?: 'neutral' | 'signal';
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <h3 className="text-[11px] font-medium uppercase tracking-brand text-steel">
        {text}
      </h3>
      {hint ? (
        <span
          className={cn(
            'text-[10px]',
            tone === 'signal' ? 'text-signal' : 'text-mist',
          )}
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function EmptyHint({
  icon,
  text,
}: {
  icon?: React.ReactNode;
  text: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-mist/70 px-3 py-3 text-xs text-steel">
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {text}
    </div>
  );
}

const guideFixtureKey = (campaignId: string, fixtureId: string) => [
  'studio',
  'guide-fixture',
  campaignId,
  fixtureId,
];

/** Ordered setup steps — one per line; saved on blur (replaces the whole list). */
function InstructionsSection({
  campaignId,
  fixtureId,
  guideFixtureId,
  steps,
}: {
  campaignId: string;
  fixtureId: string;
  guideFixtureId: string;
  steps: { id: string; text: string }[];
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const initial = steps.map((s) => s.text).join('\n');
  const [draft, setDraft] = React.useState(initial);
  const lastRef = React.useRef(initial);
  React.useEffect(() => {
    setDraft(initial);
    lastRef.current = initial;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideFixtureId, steps.length]);

  const save = useMutation({
    mutationFn: (text: string) =>
      studio.guideFixtures.saveInstructions(
        guideFixtureId,
        text
          .split('\n')
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => ({ text: t })),
      ),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: guideFixtureKey(campaignId, fixtureId) }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const commit = () => {
    if (draft === lastRef.current) return;
    lastRef.current = draft;
    save.mutate(draft);
  };

  return (
    <section>
      <SectionLabel
        text="Instructions"
        hint={save.isPending ? 'Saving…' : 'One step per line'}
        tone={save.isError ? 'signal' : 'neutral'}
      />
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        rows={5}
        placeholder={'Build the base unit\nLoad hero SKUs at eye level\nAdd price tickets + signage'}
        className="w-full resize-y rounded-md border border-mist bg-surface/40 px-3 py-2.5 font-sans text-sm leading-relaxed text-ink placeholder:text-steel focus-visible:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
      />
    </section>
  );
}

/** Per-fixture checklist authoring — the manager ticks these in the report. */
function ChecklistSection({
  campaignId,
  fixtureId,
  guideFixtureId,
  items,
}: {
  campaignId: string;
  fixtureId: string;
  guideFixtureId: string;
  items: GuideChecklistItem[];
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [newLabel, setNewLabel] = React.useState('');
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: guideFixtureKey(campaignId, fixtureId) });

  const add = useMutation({
    mutationFn: (label: string) =>
      studio.guideFixtures.checklist.add(guideFixtureId, { label }),
    onSuccess: () => {
      setNewLabel('');
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const update = useMutation({
    mutationFn: (v: { itemId: string; body: { label?: string; required?: boolean } }) =>
      studio.guideFixtures.checklist.update(guideFixtureId, v.itemId, v.body),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (itemId: string) =>
      studio.guideFixtures.checklist.remove(guideFixtureId, itemId),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <section>
      <SectionLabel text="Checklist" hint="Ticked by the store in the report" />
      <ul className="space-y-1.5">
        {items.map((it) => (
          <ChecklistRow
            key={it.id}
            item={it}
            onLabel={(label) => update.mutate({ itemId: it.id, body: { label } })}
            onRequired={(required) =>
              update.mutate({ itemId: it.id, body: { required } })
            }
            onRemove={() => remove.mutate(it.id)}
            removing={remove.isPending && remove.variables === it.id}
          />
        ))}
        {items.length === 0 ? (
          <EmptyHint text="No checklist items yet." />
        ) : null}
      </ul>
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newLabel.trim() && !add.isPending) add.mutate(newLabel.trim());
        }}
      >
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Add a checklist item…"
          className="w-full rounded-md border border-mist bg-surface/40 px-3 py-2 text-sm text-ink placeholder:text-steel focus-visible:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
        />
        <Button type="submit" size="sm" disabled={!newLabel.trim() || add.isPending}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </form>
    </section>
  );
}

function ChecklistRow({
  item,
  onLabel,
  onRequired,
  onRemove,
  removing,
}: {
  item: GuideChecklistItem;
  onLabel: (label: string) => void;
  onRequired: (required: boolean) => void;
  onRemove: () => void;
  removing: boolean;
}) {
  const [label, setLabel] = React.useState(item.label);
  React.useEffect(() => setLabel(item.label), [item.label]);
  return (
    <li className="flex items-center gap-2 rounded-md border border-mist/60 bg-paper px-2.5 py-1.5">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          const next = label.trim();
          if (next && next !== item.label) onLabel(next);
          else setLabel(item.label);
        }}
        className="min-w-0 flex-1 bg-transparent text-sm text-ink focus:outline-none"
      />
      <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-graphite">
        <input
          type="checkbox"
          checked={item.required}
          onChange={(e) => onRequired(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-mist accent-graphite"
        />
        Required
      </label>
      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        aria-label={`Remove “${item.label}”`}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-steel transition-colors hover:bg-fail/10 hover:text-fail disabled:opacity-40"
      >
        {removing ? <Spinner className="text-xs" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </li>
  );
}
