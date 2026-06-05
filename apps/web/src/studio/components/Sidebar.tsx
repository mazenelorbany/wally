import * as React from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
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
  Trophy,
  Layers,
  Users,
  ClipboardList,
  Megaphone,
  LogOut,
  Settings,
  ChevronDown,
  FolderKanban,
  Store as TradeshowIcon,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@wally/ui';

import { useLogout, useSession } from '../../lib/auth';
import { useProject } from '../ProjectContext';

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
  /** Only shown to ADMINs (operate-the-product surfaces). */
  adminOnly?: boolean;
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
      { label: 'Bulletins', icon: Megaphone, to: () => '/studio/bulletins' },
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
      },
      {
        label: 'Dashboard',
        icon: LayoutDashboard,
        to: () => '/studio/dashboard',
      },
      {
        label: 'Leaderboard',
        icon: Trophy,
        to: () => '/studio/leaderboard',
      },
      {
        label: 'Insights',
        icon: BarChart3,
        to: () => '/studio/insights',
      },
    ],
  },
  {
    title: 'Admin',
    adminOnly: true,
    items: [
      { label: 'Campaigns', icon: Layers, to: () => '/studio/campaigns' },
      {
        label: 'Store directory',
        icon: Store,
        to: () => '/studio/store-directory',
      },
      { label: 'Users', icon: Users, to: () => '/studio/users' },
      { label: 'Rubrics', icon: ClipboardList, to: () => '/studio/rubrics' },
    ],
  },
];

/** The studio's primary navigation — grouped, labeled, comprehensive. */
export function Sidebar() {
  const location = useLocation();
  const { user } = useSession();
  const isAdmin = user?.role === 'ADMIN';

  // The Sidebar renders ABOVE the floor-plan route, so useParams() never sees
  // :campaignId/:storeId — which made "Floor Plan" always fall back to
  // /studio/stores (identical to "Stores"). Derive the ids from the path, and
  // remember the last floor plan so the nav can jump back to it from anywhere.
  const m = location.pathname.match(/^\/studio\/([^/]+)\/store\/([^/]+)/);
  const current = m ? { campaignId: m[1], storeId: m[2] } : null;
  const [last, setLast] = React.useState<{
    campaignId?: string;
    storeId?: string;
  }>({});
  React.useEffect(() => {
    if (current) setLast({ campaignId: current.campaignId, storeId: current.storeId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
  const navParams = current ?? last;

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

      <ProjectSwitcher />

      {GROUPS.filter((group) => !group.adminOnly || isAdmin).map((group) => (
        <div key={group.title}>
          <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-brand text-steel">
            {group.title}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <NavRow key={item.label} item={item} params={navParams} />
            ))}
          </div>
        </div>
      ))}

      <SidebarAccount />
    </nav>
  );
}

/** Workspace switcher: pick the project (Myer / Ambiente) the studio works in. */
function ProjectSwitcher() {
  const { projects, project, setProjectId } = useProject();
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md border border-mist/70 bg-paper px-2.5 py-2 text-left hover:border-steel"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-ink/90 text-paper">
          {project?.kind === 'TRADESHOW' ? (
            <TradeshowIcon className="h-3.5 w-3.5" />
          ) : (
            <FolderKanban className="h-3.5 w-3.5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">
            {project?.name ?? 'Projects'}
          </span>
          <span className="block text-[10px] uppercase tracking-brand text-steel">
            {project ? (project.kind === 'TRADESHOW' ? 'Tradeshow' : 'Retail') : '—'}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-steel" />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-md border border-mist/70 bg-paper shadow-lift">
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setProjectId(p.id);
                setOpen(false);
                navigate('/studio');
              }}
              className={cn(
                'flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-surface',
                p.id === project?.id ? 'bg-surface/60 font-medium text-ink' : 'text-graphite',
              )}
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-mist/40 text-graphite">
                {p.kind === 'TRADESHOW' ? (
                  <TradeshowIcon className="h-3 w-3" />
                ) : (
                  <FolderKanban className="h-3 w-3" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="shrink-0 text-[10px] text-steel">{p.venueCount}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate('/studio/projects');
            }}
            className="flex w-full items-center gap-2 border-t border-mist/60 px-2.5 py-2 text-left text-xs font-medium text-steel hover:bg-surface hover:text-ink"
          >
            <FolderKanban className="h-3.5 w-3.5" /> All projects
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Bottom-of-rail account block: who you are, Settings, and Sign out. */
function SidebarAccount() {
  const { user } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();

  const signOut = async () => {
    await logout.mutateAsync();
    navigate('/login', { replace: true });
  };

  return (
    <div className="mt-auto border-t border-mist/60 pt-3">
      <div className="px-2 pb-2">
        <p className="truncate text-sm font-medium text-ink">
          {user?.name ?? user?.email ?? 'Signed in'}
        </p>
        <p className="text-[10px] uppercase tracking-brand text-steel">
          {user?.role === 'ADMIN' ? 'Admin' : 'Reviewer'}
        </p>
      </div>
      <Link
        to="/studio/settings"
        className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-graphite transition-colors hover:bg-paper hover:text-ink"
      >
        <Settings className="h-[18px] w-[18px]" />
        Settings
      </Link>
      <button
        type="button"
        onClick={signOut}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-steel transition-colors hover:bg-paper hover:text-signal"
      >
        <LogOut className="h-[18px] w-[18px]" />
        Sign out
      </button>
    </div>
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
