// =============================================================================
// Session + role context.
//
// `useSession()` reads the current user from `auth/me` (cached by react-query).
// The cookie is the source of truth — there is no token in JS. A 401 simply
// resolves to `null` (signed out) rather than throwing, so guards can branch on
// presence. Login mutations invalidate the session so the app re-renders signed
// in immediately.
// =============================================================================

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type { Role, SessionUser } from '@wally/types';

import { api, errorStatus } from './api';
import { qk } from './queryKeys';

export interface SessionState {
  user: SessionUser | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/** Current session, or null when signed out. Never throws on 401. */
export function useSession(): SessionState {
  const q = useQuery({
    queryKey: qk.me,
    queryFn: async (): Promise<SessionUser | null> => {
      try {
        return await api.auth.me();
      } catch (err) {
        // Unauthenticated is a normal state, not an error.
        if (errorStatus(err) === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  return {
    user: q.data ?? null,
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: () => void q.refetch(),
  };
}

/** Request a magic link by email. Resolves when the API accepts the request. */
export function useRequestMagicLink(): UseMutationResult<
  { sent: boolean },
  unknown,
  string
> {
  return useMutation({
    mutationFn: (email: string) => api.auth.requestMagicLink(email),
  });
}

/** Dev-only role bypass (the API rejects it outside development). */
export function useDevLogin(): UseMutationResult<SessionUser, unknown, Role> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (role: Role) => api.auth.devLogin(role),
    onSuccess: (user) => {
      qc.setQueryData(qk.me, user);
    },
  });
}

export function useLogout(): UseMutationResult<void, unknown, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.auth.logout(),
    onSuccess: () => {
      qc.setQueryData(qk.me, null);
      qc.clear();
    },
  });
}

/** Where a freshly-signed-in user of a given role should land. */
export function homeForRole(role: Role): string {
  return role === 'STORE_MANAGER' ? '/capture' : '/console';
}
