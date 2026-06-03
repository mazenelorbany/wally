import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { SessionUser } from '@wally/types';

import { AuthEnv } from './auth.config';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';

/**
 * SessionGuard — the front door for every authenticated route.
 *
 * Wally is the TRIMMED stack: no JWT bearer tokens, no Redis session store.
 * The session is an opaque hex id (Session.id == hex(randomBytes(32))) carried
 * in an httpOnly cookie. This guard:
 *
 *   1. lets @Public() routes through untouched (magic-link request/consume,
 *      google start/callback, dev-login, logout, health);
 *   2. reads SESSION_COOKIE_NAME off the request;
 *   3. resolves it to a SessionUser via AuthService (which lazily evicts
 *      expired rows);
 *   4. attaches req.user so @CurrentUser() and RolesGuard can read it;
 *   5. 401s on a missing / unknown / expired session.
 *
 * Registered globally in AuthModule (APP_GUARD), so routes are authenticated by
 * default and must opt out with @Public() — fail-closed, not fail-open.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: SessionUser; cookies?: Record<string, string> }>();

    const sessionId = req.cookies?.[AuthEnv.SESSION_COOKIE_NAME];
    if (!sessionId) {
      throw new UnauthorizedException('Not authenticated');
    }

    const user = await this.auth.resolveSession(sessionId);
    if (!user) {
      throw new UnauthorizedException('Session expired or invalid');
    }

    req.user = user;
    return true;
  }
}
