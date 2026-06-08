import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Boxes,
  ClipboardCheck,
  Coins,
  LayoutDashboard,
  Package,
  Store as StoreIcon,
  type LucideIcon,
} from 'lucide-react';
import { cn, Spinner } from '@wally/ui';

import { api } from '../../lib/api';
import { useSetStudioTopBar } from '../components/StudioContext';
import { useProject } from '../ProjectContext';

interface Pillar {
  label: string;
  desc: string;
  icon: LucideIcon;
  to: string;
  external?: boolean;
  comingSoon?: boolean;
}

// Floor Plan is reached via the store picker below (it needs a store), so it is
// not a self-looping card here. These are the other surfaces.
const PILLARS: Pillar[] = [
  {
    label: 'Fixtures',
    desc: "Your org's reusable fixture library.",
    icon: Boxes,
    to: '/studio/fixtures',
  },
  {
    label: 'Products',
    desc: 'The merchandise catalog you place on guide fixtures.',
    icon: Package,
    to: '/studio/products',
  },
  {
    label: 'Review',
    desc: 'Score and sign off store submissions.',
    icon: ClipboardCheck,
    to: '/studio/review',
  },
  {
    label: 'Money Map',
    desc: 'Where the sales sit, fixture by fixture.',
    icon: Coins,
    to: '/studio/money-map',
  },
  {
    label: 'Dashboard',
    desc: 'Guide rollout across the estate at a glance.',
    icon: LayoutDashboard,
    to: '/studio/dashboard',
  },
];

/** The studio landing — picks a store to open its floor plan, then the rest. */
export function HomeView() {
  useSetStudioTopBar({ guideName: 'Guide studio', stores: [] });

  // Scope to the selected project; list its venues so each links to a real
  // floor plan (the project's stores, not the compliance queue).
  const { project, projectId, campaignId } = useProject();

  const venuesQ = useQuery({
    queryKey: ['studio', 'project-venues', projectId],
    queryFn: () => api.projects.venues(projectId!),
    enabled: Boolean(projectId),
  });
  const stores = venuesQ.data ?? [];
  const loading = venuesQ.isLoading;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <p className="text-[11px] uppercase tracking-brand text-steel">
          Create guide
        </p>
        <h1 className="mt-1.5 font-display text-3xl font-semibold tracking-tight text-ink">
          Build the visual guide
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-steel">
          Author what good looks like — fixture by fixture, store by store — then
          publish it to the field.
        </p>
      </header>

      {/* Floor plans — the real entry point: pick a store to open its plan. */}
      <section className="mb-10">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[11px] uppercase tracking-brand text-steel">
            Floor plans — open a store
          </h2>
          {project?.campaignKey ? (
            <span className="text-xs text-steel">{project.campaignKey}</span>
          ) : null}
        </div>

        {loading ? (
          <div className="grid h-28 place-items-center">
            <Spinner className="text-xl text-steel" />
          </div>
        ) : !campaignId ? (
          <p className="text-sm text-steel">No active guide yet.</p>
        ) : stores.length === 0 ? (
          <p className="text-sm text-steel">No stores in this guide yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {stores.map((s) => (
              <Link
                key={s.storeId}
                to={`/studio/${campaignId}/store/${s.storeId}`}
                className="group flex flex-col rounded-lg border border-mist/70 bg-paper p-5 shadow-card transition-[transform,box-shadow,border-color] duration-base ease-out hover:-translate-y-0.5 hover:border-gold/40 hover:shadow-lift active:translate-y-0 active:scale-[0.99]"
              >
                <div className="flex items-center justify-between">
                  <span
                    aria-hidden="true"
                    className="grid h-10 w-10 place-items-center rounded-md bg-surface text-graphite transition-colors group-hover:bg-gold/10 group-hover:text-gold-deep"
                  >
                    <StoreIcon className="h-5 w-5" />
                  </span>
                  <ArrowRight className="h-4 w-4 text-mist transition-colors group-hover:text-gold-deep" />
                </div>
                <h3 className="mt-4 font-display text-base font-semibold tracking-tight text-ink">
                  {s.storeName}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-steel">
                  Open floor plan
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <h2 className="mb-3 text-[11px] uppercase tracking-brand text-steel">
        More
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PILLARS.map((p) => (
          <PillarCard key={p.label} pillar={p} />
        ))}
      </div>
    </div>
  );
}

function PillarCard({ pillar }: { pillar: Pillar }) {
  const Icon = pillar.icon;
  const className = cn(
    'group flex flex-col rounded-lg border border-mist/70 bg-paper p-5 shadow-card transition-shadow duration-base ease-out',
    pillar.comingSoon ? 'opacity-80' : 'hover:shadow-lift',
  );

  const body = (
    <>
      <div className="flex items-center justify-between">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 place-items-center rounded-md bg-surface text-graphite"
        >
          <Icon className="h-5 w-5" />
        </span>
        {pillar.comingSoon ? (
          <span className="rounded-full border border-mist/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-brand text-steel">
            Soon
          </span>
        ) : (
          <ArrowRight className="h-4 w-4 text-mist transition-colors group-hover:text-graphite" />
        )}
      </div>
      <h2 className="mt-4 font-display text-base font-semibold tracking-tight text-ink">
        {pillar.label}
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-steel">{pillar.desc}</p>
    </>
  );

  if (pillar.external) {
    return (
      <a href={pillar.to} className={className}>
        {body}
      </a>
    );
  }
  return (
    <Link to={pillar.to} className={className}>
      {body}
    </Link>
  );
}
