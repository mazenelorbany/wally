import * as React from 'react';
import { NavLink, useParams } from 'react-router-dom';
import {
  Home,
  LayoutDashboard,
  LayoutGrid,
  Map,
  Package,
  Coins,
  Boxes,
  ClipboardCheck,
  type LucideIcon,
} from 'lucide-react';
import { cn, Tooltip, TooltipContent, TooltipTrigger } from '@wally/ui';

interface RailItem {
  label: string;
  icon: LucideIcon;
  /** Resolve the destination from the current campaign/store route params. */
  to: (params: { campaignId?: string; storeId?: string }) => string;
  /** External-feeling links (e.g. the existing console) render as plain anchors. */
  external?: boolean;
  /** Mark as a not-yet-live destination (Money Map / Dashboard). */
  comingSoon?: boolean;
}

const RAIL: RailItem[] = [
  { label: 'Home', icon: Home, to: () => '/studio' },
  {
    label: 'Floor Plan',
    icon: Map,
    to: ({ campaignId, storeId }) =>
      campaignId && storeId
        ? `/studio/${campaignId}/store/${storeId}`
        : '/studio',
  },
  { label: 'Fixtures', icon: Boxes, to: () => '/studio/fixtures' },
  { label: 'Products', icon: Package, to: () => '/studio/products' },
  {
    label: 'Review',
    icon: ClipboardCheck,
    to: () => '/studio/review',
  },
  {
    label: 'Money Map',
    icon: Coins,
    to: () => '/studio/money-map',
  },
  {
    label: 'Dashboard',
    icon: LayoutDashboard,
    to: () => '/studio/dashboard',
  },
];

/** The left icon rail — the studio's primary navigation spine. */
export function IconRail() {
  const params = useParams<{ campaignId?: string; storeId?: string }>();

  return (
    <nav
      aria-label="Studio sections"
      className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-mist/60 bg-surface/50 py-4"
    >
      <span
        aria-hidden="true"
        className="mb-3 grid h-9 w-9 place-items-center rounded-md bg-ink text-paper"
      >
        <LayoutGrid className="h-[18px] w-[18px]" />
      </span>

      {RAIL.map((item) => (
        <RailLink key={item.label} item={item} params={params} />
      ))}
    </nav>
  );
}

function RailLink({
  item,
  params,
}: {
  item: RailItem;
  params: { campaignId?: string; storeId?: string };
}) {
  const Icon = item.icon;
  const to = item.to(params);

  const base =
    'group relative grid h-11 w-11 place-items-center rounded-lg transition-colors';

  const inner = (
    <>
      <Icon className="h-5 w-5" aria-hidden="true" />
      {item.comingSoon ? (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-mist"
        />
      ) : null}
    </>
  );

  const content = item.external ? (
    <a
      href={to}
      className={cn(base, 'text-steel hover:bg-paper hover:text-graphite')}
      aria-label={item.label}
    >
      {inner}
    </a>
  ) : (
    <NavLink
      to={to}
      end={item.label === 'Home'}
      aria-label={item.label}
      className={({ isActive }) =>
        cn(
          base,
          isActive
            ? 'bg-paper text-ink shadow-card'
            : 'text-steel hover:bg-paper hover:text-graphite',
        )
      }
    >
      {inner}
    </NavLink>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="right">
        {item.label}
        {item.comingSoon ? ' · soon' : ''}
      </TooltipContent>
    </Tooltip>
  );
}
