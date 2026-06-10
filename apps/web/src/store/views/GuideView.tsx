import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckSquare,
  ImageOff,
  Square,
  X,
  ZoomIn,
} from 'lucide-react';
import { Spinner } from '@wally/ui';

import { api } from '../../lib/api';
import { useManagerStore } from '../ManagerStoreContext';

/**
 * The fixture REFERENCE sheet — opened from the floor map. Pure read-only guide:
 * what the display should look like (reference images), the written notes, the
 * ordered setup instructions, the checklist of things to get right, and the
 * products that belong on the fixture.
 *
 * Capturing the store's own photo and ticking the checklist live in the REPORT
 * (a self-contained form), not here — the floor map is reference only, so a
 * manager or setup-crew member can read it without it turning into a task.
 */
export function GuideFixtureDetailView() {
  const { fixtureId = '' } = useParams();
  const { storeId } = useManagerStore();
  const [zoom, setZoom] = React.useState<{ url: string; label: string } | null>(null);

  const homeQ = useQuery({
    queryKey: ['manager', 'home', storeId],
    queryFn: () => api.manager.home(storeId),
  });
  const campaignId = homeQ.data?.campaignId;

  const detailQ = useQuery({
    queryKey: ['manager', 'guide-fixture', campaignId, fixtureId],
    queryFn: () => api.guideFixtures.detail(campaignId!, fixtureId),
    enabled: Boolean(campaignId && fixtureId),
  });

  if (homeQ.isLoading || detailQ.isLoading) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner className="text-2xl text-steel" />
      </div>
    );
  }

  const d = detailQ.data;
  // Best-in-class reference first, then the rest.
  const refImages = [...(d?.exampleImages ?? [])].sort(
    (a, b) => Number(b.bestInClass) - Number(a.bestInClass),
  );

  return (
    <div className="space-y-5">
      <BackLink />
      <header>
        <p className="text-[11px] uppercase tracking-brand text-steel">{d?.kind}</p>
        <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight text-ink">
          {d?.fixtureName}
        </h1>
      </header>

      {/* Reference images — "what good looks like" */}
      <section>
        <h2 className="mb-2 text-[11px] uppercase tracking-brand text-steel">
          Reference
        </h2>
        {refImages.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {refImages.map((img) => (
              <figure
                key={img.id}
                className="overflow-hidden rounded-lg border border-mist/60 bg-surface"
              >
                <button
                  type="button"
                  onClick={() => setZoom({ url: img.url, label: img.caption || 'Reference' })}
                  className="group relative block aspect-[4/3] w-full cursor-zoom-in"
                >
                  <img src={img.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  {img.bestInClass ? (
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-gold px-2 py-0.5 text-[10px] font-semibold text-ink shadow-sm">
                      Best in class
                    </span>
                  ) : null}
                  <span className="pointer-events-none absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-ink/55 text-paper opacity-0 transition-opacity group-hover:opacity-100">
                    <ZoomIn className="h-4 w-4" />
                  </span>
                </button>
                {img.caption ? (
                  <figcaption className="border-t border-mist/50 px-2.5 py-1.5 text-xs text-graphite">
                    {img.caption}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        ) : (
          <div className="grid aspect-[4/3] max-w-[280px] place-items-center rounded-lg border border-dashed border-mist/70 bg-surface/40">
            <span className="flex flex-col items-center gap-1 text-sm text-steel">
              <ImageOff className="h-5 w-5 text-mist" /> No reference image
            </span>
          </div>
        )}
      </section>

      {/* VM notes */}
      {d?.notes ? (
        <section className="rounded-lg border border-mist/60 bg-surface/40 p-3.5">
          <p className="mb-1 text-[11px] uppercase tracking-brand text-steel">VM notes</p>
          <p className="whitespace-pre-line text-sm leading-relaxed text-graphite">
            {d.notes}
          </p>
        </section>
      ) : null}

      {/* Setup instructions — ordered steps */}
      {d?.instructions && d.instructions.length > 0 ? (
        <section className="rounded-lg border border-mist/60 bg-paper p-3.5">
          <p className="mb-1.5 text-[11px] uppercase tracking-brand text-steel">
            Instructions
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-graphite">
            {d.instructions.map((s) => (
              <li key={s.id}>{s.text}</li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* Checklist — read-only reference (ticked when filling the report) */}
      {d?.checklist && d.checklist.length > 0 ? (
        <section className="rounded-lg border border-mist/60 bg-paper p-3.5">
          <p className="mb-1.5 text-[11px] uppercase tracking-brand text-steel">
            Checklist
          </p>
          <ul className="space-y-1.5">
            {d.checklist.map((item) => (
              <li key={item.id} className="flex items-start gap-2.5 text-sm text-graphite">
                <Square className="mt-0.5 h-4 w-4 shrink-0 text-mist" aria-hidden="true" />
                <span>
                  {item.label}
                  {item.required ? <span className="text-fail"> *</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-steel">
            <CheckSquare className="h-3.5 w-3.5" /> Tick these off in your report.
          </p>
        </section>
      ) : null}

      {/* Products on this fixture */}
      {d && d.merchandise.length > 0 ? (
        <section>
          <h2 className="mb-2 text-[11px] uppercase tracking-brand text-steel">
            Products on this fixture
          </h2>
          <div className="space-y-4">
            {d.merchandise.map((row) => (
              <div key={row.row}>
                {row.row ? (
                  <p className="mb-1.5 text-xs font-medium text-graphite">{row.row}</p>
                ) : null}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {row.products.map((p) => (
                    <div
                      key={p.id}
                      className="overflow-hidden rounded-lg border border-mist/60 bg-paper"
                    >
                      <div className="grid aspect-square place-items-center bg-surface">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <ImageOff className="h-5 w-5 text-mist" />
                        )}
                      </div>
                      <div className="px-2 py-1.5">
                        <p className="truncate text-xs font-medium text-ink">{p.name}</p>
                        {p.brand ? (
                          <p className="truncate text-[11px] text-steel">{p.brand}</p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <RefLightbox image={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}

/** A plain full-screen image viewer for the reference images (no defect boxes). */
function RefLightbox({
  image,
  onClose,
}: {
  image: { url: string; label: string } | null;
  onClose: () => void;
}) {
  React.useEffect(() => {
    if (!image) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [image, onClose]);

  if (!image) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.label}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85 p-4 backdrop-blur-sm"
    >
      <span className="absolute left-1/2 top-4 -translate-x-1/2 text-[11px] uppercase tracking-brand text-paper/70">
        {image.label}
      </span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-paper/15 text-paper transition-colors hover:bg-paper/25"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={image.url}
        alt={image.label}
        onClick={(e) => e.stopPropagation()}
        className="block max-h-[88vh] max-w-[94vw] rounded-lg object-contain shadow-lift"
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/store/guide"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-steel hover:text-ink"
    >
      <ArrowLeft className="h-4 w-4" /> Floor map
    </Link>
  );
}
