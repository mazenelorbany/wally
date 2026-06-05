import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SessionUser } from '@wally/types';

import { isViewer } from './role.util';

/**
 * NoViewerGuard — blocks the read-only VIEWER role from a mutating route.
 *
 * The VIEWER role (added to the Prisma schema) can see every read surface —
 * layouts, photos, scores — but must never edit or upload. Reads carry only
 * SessionGuard; mutations add this guard so a VIEWER session gets a clean 403
 * instead of writing. Must run AFTER SessionGuard (it reads req.user):
 *
 *   @UseGuards(SessionGuard, NoViewerGuard)
 *
 * Fails closed: an absent user (route mis-guarded) is rejected too.
 */
@Injectable()
export class NoViewerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: SessionUser }>();
    const user = req.user;
    if (!user) {
      throw new ForbiddenException('Insufficient permissions');
    }
    if (isViewer(user)) {
      throw new ForbiddenException('Read-only access — this action is not permitted');
    }
    return true;
  }
}
