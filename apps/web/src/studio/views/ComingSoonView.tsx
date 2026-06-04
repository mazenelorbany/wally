import * as React from 'react';
import { Coins, LayoutDashboard, Sparkles, type LucideIcon } from 'lucide-react';

import { useSetStudioTopBar } from '../components/StudioContext';

interface ComingSoonProps {
  title: string;
  icon: LucideIcon;
  lede: string;
  bullets: string[];
}

/** A tasteful, on-brand placeholder for a not-yet-built pillar. */
function ComingSoon({ title, icon: Icon, lede, bullets }: ComingSoonProps) {
  useSetStudioTopBar({ guideName: title, stores: [] });

  return (
    <div className="grid min-h-full place-items-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <span
          aria-hidden="true"
          className="mx-auto grid h-14 w-14 place-items-center rounded-xl bg-surface text-graphite"
        >
          <Icon className="h-6 w-6" />
        </span>
        <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-mist/70 bg-surface/60 px-2.5 py-1 text-[11px] font-medium uppercase tracking-brand text-steel">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          Coming soon
        </div>
        <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-steel">{lede}</p>

        <ul className="mx-auto mt-6 flex max-w-sm flex-col gap-2 text-left">
          {bullets.map((b) => (
            <li
              key={b}
              className="flex items-start gap-2.5 rounded-md border border-mist/60 bg-paper px-3 py-2.5 text-sm text-graphite shadow-card"
            >
              <span
                aria-hidden="true"
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-mist"
              />
              {b}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function MoneyMapView() {
  return (
    <ComingSoon
      title="Money Map"
      icon={Coins}
      lede="See, fixture by fixture, where the sales sit — so the guide spends attention where it pays."
      bullets={[
        'Revenue heat per fixture and bay',
        'Margin-weighted facings guidance',
        'Underperforming fixtures flagged for re-merchandising',
      ]}
    />
  );
}

export function DashboardView() {
  return (
    <ComingSoon
      title="Dashboard"
      icon={LayoutDashboard}
      lede="A single read on guide rollout: which stores are live, on-brief, and lagging."
      bullets={[
        'Guide adoption across the estate',
        'Compliance trend over time',
        'Stores that need a nudge, ranked',
      ]}
    />
  );
}
