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
  LayoutTemplate,
  Megaphone,
  GraduationCap,
  LogOut,
  Settings,
  LineChart,
  ShieldCheck,
  Building2,
  FolderKanban,
  Store as TradeshowIcon,
  type LucideIcon,
} from 'lucide-react';
import {
  cn,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@wally/ui';

import { useLogout, useSession } from '../../lib/auth';
import { useProject } from '../ProjectContext';

interface NavItem {
  label: string;
  icon: LucideIcon;
  to: (p: { campaignId?: string; storeId?: string }) => string;
  end?: boolean;
}

interface NavGroup {
  title: string;
  icon: LucideIcon;
  items: NavItem[];
  /** Only shown to ADMINs (operate-the-product surfaces). */
  adminOnly?: boolean;
}

// The day-to-day operations surfaces ride the rail directly as single-tap
// icons — labels surface on hover. The heavier, less-frequent groups
// (Analytics, Admin) collapse behind flyouts so the spine stays short.
const LEAVES: NavItem[] = [
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
  { label: 'Training', icon: GraduationCap, to: () => '/studio/resources' },
  { label: 'Review', icon: ClipboardCheck, to: () => '/studio/review' },
];

const GROUPS: NavGroup[] = [
  {
    title: 'Analytics',
    icon: LineChart,
    items: [
      { label: 'Money Map', icon: Coins, to: () => '/studio/money-map' },
      { label: 'Dashboard', icon: LayoutDashboard, to: () => '/studio/dashboard' },
      { label: 'Leaderboard', icon: Trophy, to: () => '/studio/leaderboard' },
      { label: 'Insights', icon: BarChart3, to: () => '/studio/insights' },
    ],
  },
  {
    title: 'Admin',
    icon: ShieldCheck,
    adminOnly: true,
    items: [
      { label: 'Campaigns', icon: Layers, to: () => '/studio/campaigns' },
      { label: 'Store directory', icon: Building2, to: () => '/studio/store-directory' },
      { label: 'Users', icon: Users, to: () => '/studio/users' },
      { label: 'Rubrics', icon: ClipboardList, to: () => '/studio/rubrics' },
      { label: 'Flyers', icon: LayoutTemplate, to: () => '/studio/flyers' },
    ],
  },
];

/** Shared rail-button geometry. `active` covers both route-active and open. */
const railBtn = (active: boolean) =>
  cn(
    'group relative grid h-11 w-11 place-items-center rounded-lg transition-colors duration-base ease-out',
    active
      ? 'bg-chrome-raised text-gold-bright'
      : 'text-chrome-muted hover:bg-chrome-raised/70 hover:text-chrome-ink',
  );

function isPathActive(pathname: string, to: string, end?: boolean): boolean {
  if (end) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** The studio's primary navigation — a compact icon rail with hover flyouts. */
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
      className="flex w-16 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-black/40 bg-chrome py-4 text-chrome-ink"
    >
      <Link
        to="/studio"
        aria-label="Wally home"
        className="mb-2 grid h-9 w-9 shrink-0 place-items-center rounded-md bg-gradient-to-br from-gold-bright to-gold text-chrome shadow-glow"
      >
        <span className="font-display text-[17px] font-semibold leading-none">w</span>
      </Link>

      <ProjectSwitcher />

      <div className="my-1 h-px w-8 shrink-0 bg-chrome-line" aria-hidden="true" />

      {LEAVES.map((item) => (
        <RailLeaf key={item.label} item={item} params={navParams} />
      ))}

      {GROUPS.filter((g) => !g.adminOnly || isAdmin).length ? (
        <div className="my-1 h-px w-8 shrink-0 bg-chrome-line" aria-hidden="true" />
      ) : null}

      {GROUPS.filter((g) => !g.adminOnly || isAdmin).map((group) => (
        <RailGroup key={group.title} group={group} />
      ))}

      <SidebarAccount />
    </nav>
  );
}

/**
 * A hover/click flyout anchored to the rail. Opens on hover (with a small
 * close delay so the cursor can cross the gap), on click for touch, and closes
 * on outside-click or navigation. `active` reflects route-active children.
 */
function Flyout({
  label,
  icon: Icon,
  active,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const closeTimer = React.useRef<number | undefined>(undefined);
  const { pathname } = useLocation();

  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 140);
  };

  // Close when the route changes (a child link was followed).
  React.useEffect(() => setOpen(false), [pathname]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  React.useEffect(() => () => cancelClose(), []);

  return (
    <div
      ref={wrapRef}
      className="relative shrink-0"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className={railBtn(active || open)}
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={label}
          className="menu-in absolute left-full top-0 z-30 ml-2 min-w-48 overflow-hidden rounded-md border border-chrome-line bg-chrome py-1 shadow-lift"
        >
          <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-brand text-chrome-muted">
            {label}
          </p>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** A single labeled row inside a flyout panel. */
function PanelRow({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to({})}
      end={item.end}
      role="menuitem"
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-chrome-raised font-medium text-chrome-ink'
            : 'text-chrome-muted hover:bg-chrome-raised/70 hover:text-chrome-ink',
        )
      }
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

/** A grouped rail icon whose children reveal in a flyout. */
function RailGroup({ group }: { group: NavGroup }) {
  const { pathname } = useLocation();
  const active = group.items.some((i) => isPathActive(pathname, i.to({}), i.end));
  return (
    <Flyout label={group.title} icon={group.icon} active={active}>
      {group.items.map((item) => (
        <PanelRow key={item.label} item={item} />
      ))}
    </Flyout>
  );
}

/** A single rail icon with a hover-label tooltip. */
function RailLeaf({
  item,
  params,
}: {
  item: NavItem;
  params: { campaignId?: string; storeId?: string };
}) {
  const Icon = item.icon;
  const to = item.to(params);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={to}
          end={item.end}
          aria-label={item.label}
          className={({ isActive }) => cn(railBtn(isActive), 'shrink-0')}
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

/** Workspace switcher: pick the project (Myer / Ambiente) the studio works in. */
function ProjectSwitcher() {
  const { projects, project, setProjectId } = useProject();
  const navigate = useNavigate();
  const Icon = project?.kind === 'TRADESHOW' ? TradeshowIcon : FolderKanban;

  return (
    <Flyout label={project?.name ?? 'Projects'} icon={Icon} active={false}>
      {projects.map((p) => (
        <button
          key={p.id}
          type="button"
          role="menuitem"
          onClick={() => {
            setProjectId(p.id);
            navigate('/studio');
          }}
          className={cn(
            'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
            p.id === project?.id
              ? 'bg-chrome-raised font-medium text-chrome-ink'
              : 'text-chrome-muted hover:bg-chrome-raised/70 hover:text-chrome-ink',
          )}
        >
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-chrome-raised text-gold-bright">
            {p.kind === 'TRADESHOW' ? (
              <TradeshowIcon className="h-3 w-3" />
            ) : (
              <FolderKanban className="h-3 w-3" />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
          <span className="shrink-0 text-[10px] text-chrome-muted">{p.venueCount}</span>
        </button>
      ))}
      <button
        type="button"
        role="menuitem"
        onClick={() => navigate('/studio/projects')}
        className="flex w-full items-center gap-2.5 border-t border-chrome-line px-3 py-2 text-left text-xs font-medium text-chrome-muted transition-colors hover:bg-chrome-raised hover:text-chrome-ink"
      >
        <FolderKanban className="h-3.5 w-3.5" /> All projects
      </button>
    </Flyout>
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

  const name = user?.name ?? user?.email ?? 'Signed in';
  const initials = (user?.name ?? user?.email ?? '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');

  return (
    <div className="mt-auto pt-2">
      <div className="my-1 h-px w-8 shrink-0 bg-chrome-line" aria-hidden="true" />
      <Flyout
        label="Account"
        icon={({ className }) => (
          <span
            className={cn(
              'grid h-[18px] w-[18px] place-items-center rounded-full bg-gold/15 text-[10px] font-semibold text-gold-bright',
              className,
            )}
          >
            {initials || '?'}
          </span>
        )}
        active={false}
      >
        <div className="border-b border-chrome-line px-3 pb-2 pt-1">
          <p className="truncate text-sm font-medium text-chrome-ink">{name}</p>
          <p className="text-[10px] uppercase tracking-brand text-gold">
            {user?.role === 'ADMIN' ? 'Admin' : 'Reviewer'}
          </p>
        </div>
        <Link
          to="/studio/settings"
          role="menuitem"
          className="flex items-center gap-2.5 px-3 py-2 text-sm text-chrome-muted transition-colors hover:bg-chrome-raised hover:text-chrome-ink"
        >
          <Settings className="h-[18px] w-[18px]" />
          Settings
        </Link>
        <button
          type="button"
          role="menuitem"
          onClick={signOut}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-chrome-muted transition-colors hover:bg-chrome-raised hover:text-chrome-ink"
        >
          <LogOut className="h-[18px] w-[18px]" />
          Sign out
        </button>
      </Flyout>
    </div>
  );
}
