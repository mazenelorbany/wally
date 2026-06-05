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

  // Admins pick from the live store list (active campaign's stores).
  const campaignsQ = useQuery({
    queryKey: ['manager', 'campaigns'],
    queryFn: () => api.campaigns.list(),
    enabled: canSwitch,
  });
  const campaign =
    campaignsQ.data?.find((c) => c.status === 'ACTIVE') ?? campaignsQ.data?.[0];

  const storesQ = useQuery({
    queryKey: ['manager', 'stores', campaign?.id],
    queryFn: () => api.campaigns.queue(campaign!.id),
    enabled: canSwitch && Boolean(campaign?.id),
  });

  const stores = React.useMemo(
    () =>
      (storesQ.data ?? []).map((s) => ({ id: s.storeId, name: s.storeName })),
    [storesQ.data],
  );

  const [picked, setPicked] = React.useState<string | undefined>();
  const storeId = canSwitch ? picked ?? stores[0]?.id : undefined;

  const value = React.useMemo<ManagerStoreValue>(
    () => ({
      storeId,
      setStoreId: setPicked,
      stores,
      canSwitch,
      campaignId: campaign?.id,
    }),
    [storeId, stores, canSwitch, campaign?.id],
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
