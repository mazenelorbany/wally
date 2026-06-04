import * as React from 'react';
import { NavLink, useParams } from 'react-router-dom';
import {
  Home,
  Store,
  Map,
  Boxes,
  Package,
  ClipboardCheck,
  Images,
  LayoutDashboard,
  Coins,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@wally/ui';

interface NavItem {
  label: string;
  icon: LucideIcon;
  to: (p: { campaignId?: string; storeId?: string }) => string;
  external?: boolean;
  soon?: boolean;
  end?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

// Grouped like Flagship's Navigation panel: Operations vs Analytics.
const GROUPS: NavGroup[] = [
  {
    title: 'Operations',
    items: [
      { label: 'Home', icon: Home, to: () => '/studio', end: true },
      { label: 'Stores', icon: Store, to: () => '/studio/stores' },
      {
        label: 'Floor Plan',
        icon: Map,
        to: ({ campaignId, storeId }) =>
          campaignId && storeId
            ? `/studio/${campaignId}/store/${storeId}`
            : '/studio/stores',
      },
      { label: 'Fixtures', icon: Boxes, to: () => '/studio/fixtures' },
      { label: 'Products', icon: Package, to: () => '/studio/products' },
      { label: 'Gallery', icon: Images, to: () => '/studio/gallery' },
      {
        label: 'Review',
        icon: ClipboardCheck,
        to: () => '/console',
        external: true,
      },
    ],
  },
  {
    title: 'Analytics',
    items: [
      {
        label: 'Money Map',
        icon: Coins,
        to: () => '/studio/money-map',
        soon: true,
      },
      {
        label: 'Dashboard',
        icon: LayoutDashboard,
        to: () => '/studio/dashboard',
        soon: true,
      },
      {
        label: 'Insights',
        icon: BarChart3,
        to: () => '/studio/insights',
        soon: true,
      },
    ],
  },
];

/** The studio's primary navigation — grouped, labeled, comprehensive. */
export function Sidebar() {
  const params = useParams<{ campaignId?: string; storeId?: string }>();

  return (
    <nav
      aria-label="Studio navigation"
      className="flex w-56 shrink-0 flex-col gap-5 overflow-y-auto border-r border-mist/60 bg-surface/40 px-3 py-5"
    >
      <div className="flex items-center gap-2 px-2">
        <span
          aria-hidden="true"
          className="grid h-7 w-7 place-items-center rounded-md bg-ink text-paper"
        >
          <span className="font-display text-sm font-bold">W</span>
        </span>
        <span className="font-display text-sm font-semibold tracking-tight text-ink">
          Wally<span className="text-fail">.</span>
        </span>
      </div>

      {GROUPS.map((group) => (
        <div key={group.title}>
          <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-brand text-steel">
            {group.title}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <NavRow key={item.label} item={item} params={params} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function NavRow({
  item,
  params,
}: {
  item: NavItem;
  params: { campaignId?: string; storeId?: string };
}) {
  const Icon = item.icon;
  const to = item.to(params);
  const base =
    'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors';
  const inner = (
    <>
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <span className="flex-1 truncate">{item.label}</span>
      {item.soon ? (
        <span className="rounded-full border border-mist/70 px-1.5 py-px text-[9px] font-medium uppercase tracking-brand text-steel">
          Soon
        </span>
      ) : null}
    </>
  );

  if (item.external) {
    return (
      <a
        href={to}
        className={cn(base, 'text-steel hover:bg-paper hover:text-graphite')}
      >
        {inner}
      </a>
    );
  }
  return (
    <NavLink
      to={to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          base,
          isActive
            ? 'bg-paper font-medium text-ink shadow-card'
            : 'text-graphite hover:bg-paper hover:text-ink',
        )
      }
    >
      {inner}
    </NavLink>
  );
}
