import * as React from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AppShell } from './components/AppShell';
import { RequireRole } from './components/RequireRole';
import { homeForRole, useSession } from './lib/auth';
import { LoginPage } from './login/LoginPage';
import { CapturePage } from './capture/CapturePage';
import { ConsolePage } from './console/ConsolePage';
import { StoreDetailPage } from './console/StoreDetailPage';
import { FixtureReviewPage } from './console/FixtureReviewPage';
import { studioRoutes } from './studio/routes';
import { managerRoutes } from './store/routes';
import { SettingsPage } from './components/SettingsPage';
import { Spinner } from '@wally/ui';

/** Root index — send each role to the surface they live in. */
function RoleHome() {
  const { user, isLoading } = useSession();
  if (isLoading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Spinner className="text-2xl text-steel" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homeForRole(user.role)} replace />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },

  // STORE MANAGER capture — also reachable with a submission id deep-link.
  {
    element: (
      <RequireRole roles={['STORE_MANAGER', 'ADMIN']}>
        <AppShell />
      </RequireRole>
    ),
    children: [
      { path: '/capture', element: <CapturePage /> },
      { path: '/capture/:submissionId', element: <CapturePage /> },
    ],
  },

  // REVIEWER console.
  {
    element: (
      <RequireRole roles={['REVIEWER', 'ADMIN']}>
        <AppShell />
      </RequireRole>
    ),
    children: [
      { path: '/console', element: <ConsolePage /> },
      { path: '/console/store/:id', element: <StoreDetailPage /> },
      { path: '/console/fixture/:photoId', element: <FixtureReviewPage /> },
    ],
  },

  // Shared account settings for the console/capture chrome.
  {
    element: (
      <RequireRole roles={['REVIEWER', 'ADMIN', 'STORE_MANAGER']}>
        <AppShell />
      </RequireRole>
    ),
    children: [{ path: '/settings', element: <SettingsPage /> }],
  },

  // CREATE GUIDE studio (guide authors). Self-contained route subtree with its
  // own shell; see ./studio/routes.
  studioRoutes,

  // STORE MANAGER workspace (own store: home, tasks, floor map, sales,
  // settings). Mobile-first shell; see ./store/routes.
  managerRoutes,

  { path: '/', element: <RoleHome /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);
