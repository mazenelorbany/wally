import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import type { Request } from 'express';
import type { SessionUser } from '@wally/types';

import { ROLES_KEY } from './decorators/roles.decorator';

/**
 * RolesGuard — RBAC on top of SessionGuard.
 *
 * Reads the role allow-list set by @Roles(...) and checks it against the
 * SessionUser that SessionGuard attached to req.user. Must run AFTER
 * SessionGuard — list them in that order at the route:
 *
 *   @Roles('ADMIN')
 *   @UseGuards(SessionGuard, RolesGuard)
 *
 * A route with no @Roles() metadata is allowed for any authenticated user
 * (SessionGuard has already proven identity). When req.user is somehow absent
 * we fail closed with 403 rather than trusting an un-populated request.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: SessionUser }>();
    const user = req.user;
    if (!user) {
      throw new ForbiddenException('Insufficient permissions');
    }
    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        `Requires one of: ${required.join(', ')}; have: ${user.role}`,
      );
    }
    return true;
  }
}
