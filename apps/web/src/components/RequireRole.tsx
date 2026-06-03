import * as React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Role } from '@wally/types';
import { Spinner } from '@wally/ui';

import { homeForRole, useSession } from '../lib/auth';

/**
 * Gate a route on an authenticated session and (optionally) a set of roles.
 * Signed-out users are bounced to /login (remembering where they were going).
 * Signed-in users lacking the role are sent to their own home, not shown a
 * scary 403 — the nav simply never offered them the link.
 */
export function RequireRole({
  roles,
  children,
}: {
  roles?: Role[];
  children: React.ReactNode;
}) {
  const { user, isLoading } = useSession();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Spinner className="text-2xl text-steel" label="Checking your session" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={homeForRole(user.role)} replace />;
  }

  return <>{children}</>;
}
