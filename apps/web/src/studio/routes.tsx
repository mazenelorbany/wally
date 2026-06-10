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
import { Navigate, Outlet, type RouteObject } from 'react-router-dom';

import { RequireRole } from '../components/RequireRole';
import { StudioShell } from './components/StudioShell';
import { useSetStudioTopBar } from './components/StudioContext';
import { ConsolePage } from '../console/ConsolePage';
import { StoreDetailPage } from '../console/StoreDetailPage';
import { FixtureReviewPage } from '../console/FixtureReviewPage';
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
import { ReportsView } from './views/ReportsView';
import { StoreReportView } from './views/StoreReportView';
import { TasksView } from './views/TasksView';
import { TaskBuildView } from './views/TaskBuildView';
import { StoreDirectoryView } from './views/StoreDirectoryView';
import { UsersView } from './views/UsersView';
import { RubricsView } from './views/RubricsView';
import { FlyersView } from './views/FlyersView';
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
    // Reviewer surface — the queue → store → fixture review flow. Lives INSIDE
    // the studio shell (sidebar + top bar) so reviewers never jump chrome; the
    // pages themselves are in ../console. ReviewSection supplies the studio's
    // standard page padding and a contextual top-bar title.
    {
      path: 'review',
      element: <ReviewSection />,
      children: [
        { index: true, element: <ConsolePage /> },
        { path: 'store/:id', element: <StoreDetailPage /> },
        { path: 'fixture/:fixtureId', element: <FixtureReviewPage /> },
      ],
    },
    { path: 'bulletins', element: <BulletinsView /> },
    { path: 'resources', element: <ResourcesView /> },
    { path: 'money-map', element: <MoneyMapView /> },
    { path: 'dashboard', element: <DashboardView /> },
    { path: 'leaderboard', element: <LeaderboardView /> },
    { path: 'insights', element: <InsightsView /> },
    // A task's submissions (reviewer-visible). Sending/building is on the Tasks
    // hub below (ADMIN). Old /studio/reports links still resolve here.
    { path: 'tasks/:campaignId', element: <ReportsView /> },
    // The task's content authoring page (ADMIN). Static "build" segment ranks
    // above the :storeId route below, so it never reads as a store id.
    {
      path: 'tasks/:campaignId/build',
      element: (
        <RequireRole roles={['ADMIN']}>
          <TaskBuildView />
        </RequireRole>
      ),
    },
    { path: 'tasks/:campaignId/:storeId', element: <StoreReportView /> },
    { path: 'reports', element: <ReportsView /> },
    { path: 'reports/:campaignId/:storeId', element: <StoreReportView /> },
    { path: 'settings', element: <SettingsPage /> },
    // Admin-authoring surfaces: the subtree gate also lets REVIEWERs in, so each
    // of these (all mutations are ADMIN-only on the API) gets its own ADMIN gate
    // to keep reviewers off them by URL. RequireRole redirects to their home —
    // no scary 403. Users in particular 403s on load (its list is ADMIN-only).
    {
      path: 'tasks',
      element: (
        <RequireRole roles={['ADMIN']}>
          <TasksView />
        </RequireRole>
      ),
    },
    // Back-compat: the old Campaigns URL now lives at Tasks.
    { path: 'campaigns', element: <Navigate to="/studio/tasks" replace /> },
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
    {
      path: 'flyers',
      element: (
        <RequireRole roles={['ADMIN']}>
          <FlyersView />
        </RequireRole>
      ),
    },
    { path: ':campaignId/store/:storeId', element: <FloorPlanView /> },
    // Unknown studio sub-path → back to the studio home.
    { path: '*', element: <Navigate to="/studio" replace /> },
  ],
};

/**
 * Layout wrapper for the reviewer flow. StudioShell's <main> is unpadded (each
 * view owns its container), so this supplies the studio's standard page gutters
 * for the console pages and publishes a contextual top-bar title for the whole
 * section. Set once here — the child pages keep their own in-page headers.
 */
function ReviewSection() {
  useSetStudioTopBar({ guideName: 'Review', eyebrow: 'Reviewer', stores: [] });
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Outlet />
    </div>
  );
}
