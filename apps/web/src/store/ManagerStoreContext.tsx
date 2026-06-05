import * as React from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';
import { useSession } from '../lib/auth';

/**
 * Which store the manager surface is showing.
 *
 * A real STORE_MANAGER is bound to one store (the server resolves it from the
 * session), so `storeId` stays undefined and the selector is hidden. An ADMIN /
 * REVIEWER can switch store to demo any manager's workspace — the selected
 * `storeId` flows into every `api.manager.*` call. This is the working store
 * control the manager surface was missing.
 */
interface ManagerStoreValue {
  /** storeId to pass to manager.* calls. Undefined => server uses session store. */
  storeId: string | undefined;
  setStoreId: (id: string) => void;
  /** Stores to choose from (admins only); empty for a bound manager. */
  stores: { id: string; name: string }[];
  canSwitch: boolean;
  campaignId: string | undefined;
}

const Ctx = React.createContext<ManagerStoreValue | null>(null);

export function ManagerStoreProvider({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const canSwitch = user?.role === 'ADMIN' || user?.role === 'REVIEWER';

  // Admins pick from the real store list. Managers run RETAIL stores, so resolve
  // the retail project (Myer) and list its venues — NOT campaigns.queue, which is
  // the submission queue (only stores that have submitted) and goes empty for the
  // cross-project "first active campaign". Mirrors the studio StoresView fix.
  const projectsQ = useQuery({
    queryKey: ['manager', 'projects'],
    queryFn: () => api.projects.list(),
    enabled: canSwitch,
  });
  const project = React.useMemo(() => {
    const all = projectsQ.data ?? [];
    return (
      all.find((p) => p.kind === 'RETAIL' && p.venueCount > 0) ??
      all.find((p) => p.kind === 'RETAIL') ??
      all[0]
    );
  }, [projectsQ.data]);

  const venuesQ = useQuery({
    queryKey: ['manager', 'venues', project?.id],
    queryFn: () => api.projects.venues(project!.id),
    enabled: canSwitch && Boolean(project?.id),
  });

  const stores = React.useMemo(
    () =>
      (venuesQ.data ?? []).map((s) => ({ id: s.storeId, name: s.storeName })),
    [venuesQ.data],
  );

  const [picked, setPicked] = React.useState<string | undefined>();
  const storeId = canSwitch ? picked ?? stores[0]?.id : undefined;
  const campaignId = project?.campaignId ?? undefined;

  const value = React.useMemo<ManagerStoreValue>(
    () => ({
      storeId,
      setStoreId: setPicked,
      stores,
      canSwitch,
      campaignId,
    }),
    [storeId, stores, canSwitch, campaignId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useManagerStore(): ManagerStoreValue {
  const ctx = React.useContext(Ctx);
  if (!ctx) {
    return {
      storeId: undefined,
      setStoreId: () => {},
      stores: [],
      canSwitch: false,
      campaignId: undefined,
    };
  }
  return ctx;
}
