import type { SessionUser } from '@wally/types';

// The @wally/types `Role` union doesn't (yet) list VIEWER, but the Prisma schema
// + DB do, and AuthService mints VIEWER sessions. So at runtime `user.role` can
// be 'VIEWER'; we compare through `string` to read it without a contract edit.

/** True when the session belongs to the read-only VIEWER role. */
export function isViewer(user: Pick<SessionUser, 'role'>): boolean {
  return (user.role as string) === 'VIEWER';
}
