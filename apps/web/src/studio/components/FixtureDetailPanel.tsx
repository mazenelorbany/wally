import * as React from 'react';
import { ImageIcon, Star, X } from 'lucide-react';
import { Badge, Button, cn, Spinner } from '@wally/ui';

import { ErrorState } from '../../components/states';
import { useGuideFixture, useSaveNotes } from '../lib/hooks';
import { fixtureKindMeta } from '../lib/fixtureKind';
import { ProductThumb } from './ProductThumb';

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
    saveNotes.mutate({ id: detail.fixtureId, notes: draft });
  };

  const meta = detail ? fixtureKindMeta(detail.kind) : null;
  const KindIcon = meta?.icon;

  return (
    <aside
      role="dialog"
      aria-label="Fixture instructions"
      className="flex h-full w-full flex-col border-l border-mist/60 bg-paper shadow-lift"
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

            {/* Merchandise planogram */}
            <section>
              <SectionLabel text="Merchandise" />
              {detail.merchandise.length > 0 ? (
                <div className="flex flex-col gap-4">
                  {detail.merchandise.map((row) => (
                    <div key={row.row}>
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-brand text-steel">
                        {row.row}
                      </p>
                      <div className="grid grid-cols-3 gap-2.5">
                        {row.products.map((p) => (
                          <article
                            key={p.id}
                            className="flex flex-col gap-1.5"
                            title={`${p.name} · ${p.sku}`}
                          >
                            <ProductThumb
                              imageUrl={p.imageUrl}
                              sku={p.sku}
                              name={p.name}
                              className="aspect-square"
                            />
                            <div className="min-w-0 leading-tight">
                              <p className="truncate text-xs font-medium text-ink">
                                {p.name}
                              </p>
                              <p className="truncate text-[10px] uppercase tracking-brand text-steel">
                                {p.sku}
                                {p.brand ? ` · ${p.brand}` : ''}
                              </p>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyHint text="No products placed on this fixture yet." />
              )}
            </section>
          </div>
        ) : null}
      </div>
    </aside>
  );
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
