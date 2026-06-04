import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Boxes,
  ClipboardCheck,
  Coins,
  LayoutDashboard,
  Map,
  Package,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@wally/ui';

import { useSetStudioTopBar } from '../components/StudioContext';

interface Pillar {
  label: string;
  desc: string;
  icon: LucideIcon;
  to: string;
  external?: boolean;
  comingSoon?: boolean;
}

const PILLARS: Pillar[] = [
  {
    label: 'Floor Plan',
    desc: 'Lay out fixtures on each store and author the guide visually.',
    icon: Map,
    to: '/studio',
  },
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
    desc: 'Score and sign off store submissions in the console.',
    icon: ClipboardCheck,
    to: '/console',
    external: true,
  },
  {
    label: 'Money Map',
    desc: 'Where the sales sit, fixture by fixture.',
    icon: Coins,
    to: '/studio/money-map',
    comingSoon: true,
  },
  {
    label: 'Dashboard',
    desc: 'Guide rollout across the estate at a glance.',
    icon: LayoutDashboard,
    to: '/studio/dashboard',
    comingSoon: true,
  },
];

/** The studio landing — orients the author and routes into each pillar. */
export function HomeView() {
  useSetStudioTopBar({ guideName: 'Guide studio', stores: [] });

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
          publish it to the field. Everything a store needs to merchandise to
          brief, in one place.
        </p>
      </header>

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
