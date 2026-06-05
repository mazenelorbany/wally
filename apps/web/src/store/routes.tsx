// =============================================================================
// STORE MANAGER — the manager's own-store workspace route tree.
//
// Mounted at /store with its own mobile-first shell (ManagerShell). A store
// manager lands here (homeForRole); an ADMIN/REVIEWER can open it too and use
// the store switcher to view any store's workspace for the demo.
// =============================================================================

import * as React from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';

import { RequireRole } from '../components/RequireRole';
import { ManagerShell } from './ManagerShell';
import { ManagerHome } from './views/ManagerHome';
import { TasksView } from './views/TasksView';
import { ManagerFloorView } from './views/ManagerFloorView';
import { GuideFixtureDetailView } from './views/GuideView';
import { ManagerProductsView } from './views/ManagerProductsView';
import { SalesLogView } from './views/SalesLogView';
import { ManagerBulletinsView } from './views/ManagerBulletinsView';
import { ManagerSettingsView } from './views/ManagerSettingsView';

export const managerRoutes: RouteObject = {
  path: '/store',
  element: (
    <RequireRole roles={['STORE_MANAGER', 'ADMIN', 'REVIEWER']}>
      <ManagerShell />
    </RequireRole>
  ),
  children: [
    { index: true, element: <ManagerHome /> },
    { path: 'tasks', element: <TasksView /> },
    { path: 'guide', element: <ManagerFloorView /> },
    { path: 'guide/:fixtureId', element: <GuideFixtureDetailView /> },
    { path: 'products', element: <ManagerProductsView /> },
    { path: 'sales', element: <SalesLogView /> },
    { path: 'bulletins', element: <ManagerBulletinsView /> },
    { path: 'settings', element: <ManagerSettingsView /> },
    { path: '*', element: <Navigate to="/store" replace /> },
  ],
};
