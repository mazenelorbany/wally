import * as React from 'react';
import type { StudioStore } from './TopBar';

/**
 * Lets a view feed live context (guide name, the store set, the active store, a
 * publish handler) up into the shared TopBar without prop-drilling through the
 * router. Views call `useSetStudioTopBar(...)`; the shell reads `useStudioTopBar`.
 */
export interface StudioTopBarState {
  guideName: string;
  guideKey?: string;
  stores: StudioStore[];
  storeId?: string;
  onStoreChange?: (storeId: string) => void;
  onPublish?: () => void;
  publishing?: boolean;
}

const DEFAULT: StudioTopBarState = {
  guideName: 'Guide studio',
  stores: [],
};

interface ContextValue {
  state: StudioTopBarState;
  set: (next: StudioTopBarState) => void;
}

const StudioTopBarContext = React.createContext<ContextValue | null>(null);

export function StudioTopBarProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<StudioTopBarState>(DEFAULT);
  const value = React.useMemo<ContextValue>(
    () => ({ state, set: setState }),
    [state],
  );
  return (
    <StudioTopBarContext.Provider value={value}>
      {children}
    </StudioTopBarContext.Provider>
  );
}

export function useStudioTopBar(): StudioTopBarState {
  const ctx = React.useContext(StudioTopBarContext);
  return ctx?.state ?? DEFAULT;
}

/**
 * Publish top-bar context for the lifetime of a view. Resets to the default on
 * unmount so a stale guide name never lingers when you navigate away.
 */
export function useSetStudioTopBar(next: StudioTopBarState): void {
  const ctx = React.useContext(StudioTopBarContext);
  const set = ctx?.set;
  // Stringify the stable parts so we only re-publish on meaningful changes
  // (not on every render-fresh handler identity).
  const signature = JSON.stringify({
    guideName: next.guideName,
    guideKey: next.guideKey,
    stores: next.stores,
    storeId: next.storeId,
    publishing: next.publishing,
  });

  React.useEffect(() => {
    if (!set) return;
    set(next);
    return () => set(DEFAULT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, signature]);
}
