// =============================================================================
// SETUP CREW — a floor-plan-only workspace for the store-setup team.
//
// A crew member is pinned to one store (like a manager). They see ONLY the
// floor plan; tapping a fixture opens a READ-ONLY setup sheet — reference image,
// instructions, products, and the checklist — so they can build the display.
// No reports, no photo upload, no analytics, no admin.
// =============================================================================

import * as React from 'react';
import {
  Link,
  Navigate,
  Outlet,
  useNavigate,
  useParams,
  type RouteObject,
} from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ImageOff, LogOut, Square } from 'lucide-react';
import { Spinner } from '@wally/ui';
import type { FixtureCompliance } from '@wally/sdk';

import { api } from '../lib/api';
import { useLogout, useSession } from '../lib/auth';
import { RequireRole } from '../components/RequireRole';
import { Wordmark } from '../components/Brand';
import { ErrorState } from '../components/states';
import { FloorCanvas } from '../store/views/ManagerFloorView';

function CrewShell() {
  const { user } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  // Crew is pinned to their own store; home resolves it server-side.
  const homeQ = useQuery({
    queryKey: ['crew', 'home'],
    queryFn: () => api.manager.home(),
  });

  const signOut = async () => {
    await logout.mutateAsync();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-chrome-line/70 bg-chrome px-4 text-chrome-ink sm:px-6">
        <Wordmark tone="dark" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {homeQ.data?.storeName ?? 'Store setup'}
          </p>
          <p className="text-[10px] uppercase tracking-brand text-gold">Setup crew</p>
        </div>
        <div className="ml-auto flex items-center gap-3 text-right">
          <span className="hidden text-sm text-chrome-muted sm:inline">
            {user?.name ?? user?.email}
          </span>
          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            className="grid h-9 w-9 place-items-center rounded-md text-chrome-muted transition-colors hover:bg-chrome-raised hover:text-chrome-ink"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}

function CrewFloorView() {
  const navigate = useNavigate();
  const homeQ = useQuery({
    queryKey: ['crew', 'home'],
    queryFn: () => api.manager.home(),
  });
  const campaignId = homeQ.data?.campaignId;
  const storeId = homeQ.data?.storeId;

  const planQ = useQuery({
    queryKey: ['crew', 'floor', campaignId, storeId],
    queryFn: () => api.floorplan.get(campaignId!, storeId!),
    enabled: Boolean(campaignId && storeId),
  });
  const statusQ = useQuery({
    queryKey: ['crew', 'compliance'],
    queryFn: () => api.manager.compliance(),
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
      <ErrorState
        error={q.error}
        onRetry={() => void q.refetch()}
        title="Couldn't load the floor plan"
      />
    );
  }
  const plan = planQ.data;
  if (!plan) {
    return <p className="text-sm text-steel">No floor plan for this store yet.</p>;
  }
  const applicable = plan.placements.filter((p) => p.applicable);

  return (
    <div className="space-y-4">
      <header>
        <p className="text-[11px] uppercase tracking-brand text-steel">
          {plan.campaignKey} · Floor plan
        </p>
        <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight text-ink">
          {plan.storeName}
        </h1>
        <p className="mt-1 text-sm text-steel">
          Tap a fixture to see how to set it up.
        </p>
      </header>
      <FloorCanvas
        placements={applicable}
        statusByFixture={statusByFixture}
        onPick={(p) => navigate(`/crew/fixture/${encodeURIComponent(p.fixtureId)}`)}
      />
    </div>
  );
}

function CrewFixtureView() {
  const { fixtureId = '' } = useParams();
  const homeQ = useQuery({
    queryKey: ['crew', 'home'],
    queryFn: () => api.manager.home(),
  });
  const campaignId = homeQ.data?.campaignId;
  const detailQ = useQuery({
    queryKey: ['crew', 'guide-fixture', campaignId, fixtureId],
    queryFn: () => api.guideFixtures.detail(campaignId!, fixtureId),
    enabled: Boolean(campaignId && fixtureId),
  });

  const d = detailQ.data;
  const reference = d?.exampleImages?.[0];

  return (
    <div className="space-y-4">
      <Link
        to="/crew"
        className="inline-flex items-center gap-1.5 text-sm text-steel hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Floor plan
      </Link>

      {detailQ.isLoading ? (
        <div className="grid h-48 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : detailQ.isError ? (
        <ErrorState
          error={detailQ.error}
          onRetry={() => void detailQ.refetch()}
          title="Couldn't load this fixture"
        />
      ) : d ? (
        <>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            {d.fixtureName}
          </h1>

          {/* Reference image — "what good looks like" */}
          <figure className="overflow-hidden rounded-lg border border-mist/60 bg-surface">
            <div className="relative aspect-[4/3]">
              {reference?.url ? (
                <img
                  src={reference.url}
                  alt="Reference"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="grid h-full w-full place-items-center text-steel">
                  <ImageOff className="h-6 w-6 text-mist" />
                </span>
              )}
            </div>
            {reference?.caption ? (
              <figcaption className="border-t border-mist/50 px-3 py-1.5 text-xs text-steel">
                {reference.caption}
              </figcaption>
            ) : null}
          </figure>

          {/* Instructions */}
          {d.instructions.length > 0 ? (
            <section className="rounded-lg border border-mist/60 bg-surface/40 p-3.5">
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

          {/* VM notes */}
          {d.notes ? (
            <section className="rounded-lg border border-mist/60 bg-surface/40 p-3.5">
              <p className="mb-1 text-[11px] uppercase tracking-brand text-steel">
                Notes
              </p>
              <p className="whitespace-pre-line text-sm leading-relaxed text-graphite">
                {d.notes}
              </p>
            </section>
          ) : null}

          {/* Checklist (read-only reference for setup) */}
          {d.checklist.length > 0 ? (
            <section className="rounded-lg border border-mist/60 bg-paper p-3.5">
              <p className="mb-1.5 text-[11px] uppercase tracking-brand text-steel">
                Checklist
              </p>
              <ul className="space-y-1.5">
                {d.checklist.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-start gap-2 text-sm text-graphite"
                  >
                    <Square className="mt-0.5 h-4 w-4 shrink-0 text-mist" />
                    <span>
                      {c.label}
                      {c.required ? <span className="text-fail"> *</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Products on the fixture */}
          {d.merchandise.length > 0 ? (
            <section>
              <p className="mb-2 text-[11px] uppercase tracking-brand text-steel">
                Products
              </p>
              <div className="space-y-3">
                {d.merchandise.map((row) => (
                  <div key={row.row}>
                    {row.row ? (
                      <p className="mb-1.5 text-xs font-medium text-graphite">
                        {row.row}
                      </p>
                    ) : null}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {row.products.map((p) => (
                        <div
                          key={p.id}
                          className="overflow-hidden rounded-lg border border-mist/60 bg-paper"
                        >
                          <div className="grid aspect-square place-items-center bg-surface">
                            {p.imageUrl ? (
                              <img
                                src={p.imageUrl}
                                alt=""
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <ImageOff className="h-5 w-5 text-mist" />
                            )}
                          </div>
                          <div className="px-2 py-1.5">
                            <p className="truncate text-xs font-medium text-ink">
                              {p.name}
                            </p>
                            {p.brand ? (
                              <p className="truncate text-[11px] text-steel">
                                {p.brand}
                              </p>
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
        </>
      ) : null}
    </div>
  );
}

/** The crew route subtree — mounted at /crew, gated to SETUP_CREW (+ ADMIN). */
export const crewRoutes: RouteObject = {
  path: '/crew',
  element: (
    <RequireRole roles={['SETUP_CREW', 'ADMIN']}>
      <CrewShell />
    </RequireRole>
  ),
  children: [
    { index: true, element: <CrewFloorView /> },
    { path: 'fixture/:fixtureId', element: <CrewFixtureView /> },
    { path: '*', element: <Navigate to="/crew" replace /> },
  ],
};
