import * as React from 'react';
import { ImageIcon, Plus, Search, Star, Trash2, X } from 'lucide-react';
import { Badge, Button, cn, Spinner } from '@wally/ui';

import { ErrorState } from '../../components/states';
import { errorMessage } from '../../lib/api';
import {
  useAddMerchandise,
  useFixtureProducts,
  useGuideFixture,
  usePrepopulate,
  useProducts,
  useRemoveMerchandise,
  useSaveNotes,
} from '../lib/hooks';
import { fixtureKindMeta } from '../lib/fixtureKind';
import { ProductThumb } from './ProductThumb';
import { PlanogramEditor } from './PlanogramEditor';

/**
 * The fixture instruction sheet — a right-rail slide-over opened by clicking a
 * box on the floor plan. Shows the fixture name + kind, the editable VM notes
 * (saved on blur), the "what good looks like" example images, and the
 * merchandise planogram grouped by row.
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
          <div className="flex flex-col gap-7">
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

            {/* Example images */}
            <section>
              <SectionLabel
                text={`What good looks like · ${detail.exampleImages.length}`}
              />
              {detail.exampleImages.length > 0 ? (
                <div className="grid grid-cols-2 gap-2.5">
                  {detail.exampleImages.map((img) => (
                    <figure
                      key={img.id}
                      className="overflow-hidden rounded-md border border-mist/60 bg-surface"
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
                            <Star
                              className="h-3 w-3 fill-paper"
                              aria-hidden="true"
                            />
                            Best in class
                          </span>
                        ) : null}
                      </div>
                      {img.caption ? (
                        <figcaption className="px-2 py-1.5 text-[11px] leading-snug text-steel">
                          {img.caption}
                        </figcaption>
                      ) : null}
                    </figure>
                  ))}
                </div>
              ) : (
                <EmptyHint
                  icon={<ImageIcon className="h-4 w-4" />}
                  text="No reference images yet."
                />
              )}
            </section>

            {/* Merchandise planogram — add / remove products */}
            <MerchandiseSection
              campaignId={campaignId}
              fixtureId={fixtureId}
              guideFixtureId={detail.guideFixtureId}
              merchandise={detail.merchandise}
            />
          </div>
        ) : null}
      </div>
    </aside>
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
          campaignId={campaignId}
          fixtureId={fixtureId}
          guideFixtureId={guideFixtureId}
          merchandise={merchandise}
          onDone={() => setEditing(false)}
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
