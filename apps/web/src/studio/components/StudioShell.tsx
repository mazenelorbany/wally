import * as React from 'react';
import { Outlet } from 'react-router-dom';
import { TooltipProvider } from '@wally/ui';

import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import {
  StudioTopBarProvider,
  useStudioTopBar,
} from './StudioContext';
import { ProjectProvider } from '../ProjectContext';

/** The signed-in CREATE GUIDE chrome: left icon rail + contextual top bar. */
export function StudioShell() {
  return (
    <TooltipProvider delayDuration={200}>
      <ProjectProvider>
        <StudioTopBarProvider>
          <div className="flex h-dvh overflow-hidden bg-paper text-ink">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <TopBarBridge />
              <main className="min-h-0 flex-1 overflow-y-auto">
                <Outlet />
              </main>
            </div>
          </div>
        </StudioTopBarProvider>
      </ProjectProvider>
    </TooltipProvider>
  );
}

/** Reads view-published context and renders the shared TopBar. */
function TopBarBridge() {
  const s = useStudioTopBar();
  return (
    <TopBar
      guideName={s.guideName}
      guideKey={s.guideKey}
      eyebrow={s.eyebrow}
      stores={s.stores}
      storeId={s.storeId}
      onStoreChange={s.onStoreChange}
      onPublish={s.onPublish}
      publishing={s.publishing}
    />
  );
}
