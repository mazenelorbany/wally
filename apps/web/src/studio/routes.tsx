// =============================================================================
// CREATE GUIDE — studio route tree.
//
// Exported as a single route object so the app router (apps/web/src/router.tsx)
// can drop the whole studio in with one entry, guarded for guide authors. The
// studio is org-scoped, signed-in chrome (StudioShell) wrapping the full
// surface: guide authoring (Floor Plan / Fixtures / Products / Rubrics),
// comms (Bulletins / Resources), analytics, and admin (Campaigns / Stores /
// Users). Every pillar is live — there are no placeholder routes.
// =============================================================================

import * as React from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';

import { RequireRole } from '../components/RequireRole';
import { StudioShell } from './components/StudioShell';
import { HomeView } from './views/HomeView';
import { FloorPlanView } from './views/FloorPlanView';
import { FixturesView } from './views/FixturesView';
import { ProductsView } from './views/ProductsView';
import { StoresView } from './views/StoresView';
import { GalleryView } from './views/GalleryView';
import { MoneyMapView } from './views/MoneyMapView';
import { DashboardView } from './views/DashboardView';
import { LeaderboardView } from './views/LeaderboardView';
import { InsightsView } from './views/InsightsView';
import { CampaignsView } from './views/CampaignsView';
import { StoreDirectoryView } from './views/StoreDirectoryView';
import { UsersView } from './views/UsersView';
import { RubricsView } from './views/RubricsView';
import { ProjectsView } from './views/ProjectsView';
import { BulletinsView } from './views/BulletinsView';
import { ResourcesView } from './views/ResourcesView';
import { SettingsPage } from '../components/SettingsPage';

/** The studio route subtree. Mount at the app router top level. */
export const studioRoutes: RouteObject = {
  path: '/studio',
  element: (
    <RequireRole roles={['ADMIN', 'REVIEWER']}>
      <StudioShell />
    </RequireRole>
  ),
  children: [
    { index: true, element: <HomeView /> },
    { path: 'projects', element: <ProjectsView /> },
    { path: 'stores', element: <StoresView /> },
    { path: 'fixtures', element: <FixturesView /> },
    { path: 'products', element: <ProductsView /> },
    { path: 'gallery', element: <GalleryView /> },
    { path: 'bulletins', element: <BulletinsView /> },
    { path: 'resources', element: <ResourcesView /> },
    { path: 'money-map', element: <MoneyMapView /> },
    { path: 'dashboard', element: <DashboardView /> },
    { path: 'leaderboard', element: <LeaderboardView /> },
    { path: 'insights', element: <InsightsView /> },
    { path: 'settings', element: <SettingsPage /> },
    // Admin-authoring surfaces: the subtree gate also lets REVIEWERs in, so each
    // of these (all mutations are ADMIN-only on the API) gets its own ADMIN gate
    // to keep reviewers off them by URL. RequireRole redirects to their home —
    // no scary 403. Users in particular 403s on load (its list is ADMIN-only).
    {
      path: 'campaigns',
      element: (
        <RequireRole roles={['ADMIN']}>
          <CampaignsView />
        </RequireRole>
      ),
    },
    {
      path: 'store-directory',
      element: (
        <RequireRole roles={['ADMIN']}>
          <StoreDirectoryView />
        </RequireRole>
      ),
    },
    {
      path: 'users',
      element: (
        <RequireRole roles={['ADMIN']}>
          <UsersView />
        </RequireRole>
      ),
    },
    {
      path: 'rubrics',
      element: (
        <RequireRole roles={['ADMIN']}>
          <RubricsView />
        </RequireRole>
      ),
    },
    { path: ':campaignId/store/:storeId', element: <FloorPlanView /> },
    // Unknown studio sub-path → back to the studio home.
    { path: '*', element: <Navigate to="/studio" replace /> },
  ],
};
