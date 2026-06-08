import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Camera, CheckCircle2, CircleDashed, Info } from 'lucide-react';
import { cn, Spinner } from '@wally/ui';
import type { FixtureCompliance, PlacedFixture } from '@wally/sdk';

import { api } from '../../lib/api';
import { ErrorState } from '../../components/states';
import { fixtureKindMeta } from '../../studio/lib/fixtureKind';
import { useManagerStore } from '../ManagerStoreContext';

// Logical floor-plan plane — same units as the studio canvas (FloorPlanCanvas),
// so the manager sees the SAME block layout admins lay out, just read-only.
const PLAN_W = 1000;
const PLAN_H = 640;

/**
 * The manager's OWN store floor map. Read-only geometry (reused from the studio
 * canvas), but every applicable fixture is a tap target into its compliance
 * sheet: reference photo + VM notes → upload yours → AI compares. Fixtures
 * needing a photo this sale carry a camera flag; captured ones a check. Status
 * is icon + label, never colour alone (colour-blind safe).
 */
export function ManagerFloorView() {
  const { storeId } = useManagerStore();
  const navigate = useNavigate();

  const homeQ = useQuery({
    queryKey: ['manager', 'home', storeId],
    queryFn: () => api.manager.home(storeId),
  });
  const resolvedStoreId = homeQ.data?.storeId;
  const campaignId = homeQ.data?.campaignId;

  const planQ = useQuery({
    queryKey: ['manager', 'floor', campaignId, resolvedStoreId],
    queryFn: () => api.floorplan.get(campaignId!, resolvedStoreId!),
    enabled: Boolean(campaignId && resolvedStoreId),
  });

  // Per-fixture compliance status for this store (photo wanted / captured / scored).
  const statusQ = useQuery({
    queryKey: ['manager', 'compliance', storeId],
    queryFn: () => api.manager.compliance(storeId),
  });
  const statusByFixture = React.useMemo(() => {
    const m = new Map<string, FixtureCompliance>();
    for (const s of statusQ.data ?? []) m.set(s.fixtureId, s);
    return m;
  }, [statusQ.data]);

  if (homeQ.isLoading || planQ.isLoading) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner className="text-2xl text-steel" />
      </div>
    );
  }
  if (homeQ.isError || planQ.isError) {
    const q = homeQ.isError ? homeQ : planQ;
    return (
      <div className="px-4 py-6">
        <ErrorState
          error={q.error}
          onRetry={() => void q.refetch()}
          title="Couldn't load your floor plan"
        />
      </div>
    );
  }
  const plan = planQ.data;
  if (!plan) {
    return <p className="text-sm text-steel">No floor plan for your store yet.</p>;
  }

  const applicable = plan.placements.filter((p) => p.applicable);
  const needed = applicable.filter((p) => statusByFixture.get(p.fixtureId)?.needsPhoto).length;

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-brand text-steel">
            {plan.campaignKey} · Floor map
          </p>
          <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight text-ink">
            {plan.storeName}
          </h1>
        </div>
        {needed > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-signal/10 px-2.5 py-1 text-xs font-medium text-signal">
            <Camera className="h-3.5 w-3.5" /> {needed} need a photo
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-pass/10 px-2.5 py-1 text-xs font-medium text-pass">
            <CheckCircle2 className="h-3.5 w-3.5" /> All captured
          </span>
        )}
      </header>

      <p className="flex items-center gap-1.5 text-xs text-steel">
        <Info className="h-3.5 w-3.5" /> Tap a fixture to see the guide and submit
        your photo for review.
      </p>

      <FloorCanvas
        placements={applicable}
        statusByFixture={statusByFixture}
        onPick={(p) => navigate(`/store/guide/${encodeURIComponent(p.fixtureId)}`)}
      />

      {/* Legend — icon + label, colour-blind safe */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-steel">
        <span className="inline-flex items-center gap-1">
          <Camera className="h-3.5 w-3.5 text-signal" /> Needs photo
        </span>
        <span className="inline-flex items-center gap-1">
          <CircleDashed className="h-3.5 w-3.5 text-steel" /> Awaiting score
        </span>
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5 text-pass" /> Scored
        </span>
      </div>
    </div>
  );
}

function FloorCanvas({
  placements,
  statusByFixture,
  onPick,
}: {
  placements: PlacedFixture[];
  statusByFixture: Map<string, FixtureCompliance>;
  onPick: (p: PlacedFixture) => void;
}) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);
  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth > 0 ? el.clientWidth / PLAN_W : 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="w-full">
      {/* Same plane + subtle grid as the studio FloorPlanCanvas, so the manager
          sees the admin's block layout — but read-only (tap to open, no edit). */}
      <div
        className="relative overflow-hidden rounded-xl border border-mist/70 bg-paper shadow-card"
        style={{
          width: `${PLAN_W * scale}px`,
          height: `${PLAN_H * scale}px`,
          backgroundImage:
            'linear-gradient(to right, rgba(190,189,182,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(190,189,182,0.16) 1px, transparent 1px)',
          backgroundSize: `${40 * scale}px ${40 * scale}px`,
        }}
      >
        {placements.map((p) => {
          const st = statusByFixture.get(p.fixtureId);
          const needs = st?.needsPhoto;
          const scored = st?.state === 'scored';
          const submitted = st?.state === 'submitted';
          const meta = fixtureKindMeta(p.kind);
          const Icon = meta.icon;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p)}
              aria-label={`${p.label} — ${meta.label}${
                needs ? ' — needs a photo' : scored ? ' — scored' : submitted ? ' — awaiting score' : ''
              }`}
              className={cn(
                'group absolute flex flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border bg-surface text-center outline-none transition-shadow duration-base ease-out hover:shadow-card focus-visible:ring-2 focus-visible:ring-ink',
                // Needs-photo is the one call to action — flag it with the stop
                // colour AND an icon (never colour alone; colour-blind safe).
                needs ? 'border-signal' : 'border-graphite/70',
              )}
              style={{
                left: `${p.x * scale}px`,
                top: `${p.y * scale}px`,
                width: `${p.w * scale}px`,
                height: `${p.h * scale}px`,
                transform: p.rotation ? `rotate(${p.rotation}deg)` : undefined,
              }}
            >
              <Icon className="h-4 w-4 shrink-0 text-graphite" aria-hidden="true" />
              <span className="px-1 font-display text-[11px] font-semibold leading-tight tracking-tight text-ink">
                {p.label}
              </span>
              {needs ? (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-signal">
                  <Camera className="h-3 w-3" /> Needs photo
                </span>
              ) : scored ? (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-tight text-steel">
                  <CheckCircle2 className="h-3 w-3 text-pass" />
                  {st?.overall === 'FAIL'
                    ? 'Fail'
                    : st?.overall === 'NEEDS_REVIEW'
                      ? 'Review'
                      : 'Pass'}
                </span>
              ) : submitted ? (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-steel">
                  <CircleDashed className="h-3 w-3" /> Awaiting
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
