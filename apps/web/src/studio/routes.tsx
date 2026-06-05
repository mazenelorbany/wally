// =============================================================================
// CREATE GUIDE — studio route tree.
//
// Exported as a single route object so the app router (apps/web/src/router.tsx)
// can drop the whole studio in with one entry, guarded for guide authors. The
// studio is org-scoped, signed-in chrome (StudioShell) wrapping the live pillars
// (Floor Plan / Fixtures / Products) plus tasteful Coming-soon placeholders.
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
    { path: 'money-map', element: <MoneyMapView /> },
    { path: 'dashboard', element: <DashboardView /> },
    { path: 'leaderboard', element: <LeaderboardView /> },
    { path: 'insights', element: <InsightsView /> },
    { path: 'settings', element: <SettingsPage /> },
    { path: 'campaigns', element: <CampaignsView /> },
    { path: 'store-directory', element: <StoreDirectoryView /> },
    { path: 'users', element: <UsersView /> },
    { path: 'rubrics', element: <RubricsView /> },
    { path: ':campaignId/store/:storeId', element: <FloorPlanView /> },
    // Unknown studio sub-path → back to the studio home.
    { path: '*', element: <Navigate to="/studio" replace /> },
  ],
};
