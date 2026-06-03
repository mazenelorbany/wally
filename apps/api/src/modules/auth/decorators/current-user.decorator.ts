import {
  createParamDecorator,
  InternalServerErrorException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SessionUser } from '@wally/types';

/**
 * @CurrentUser() — pulls the SessionUser attached by SessionGuard onto
 * req.user. Throws if used on a route that wasn't guarded (programmer error),
 * so a missing user is never silently coerced to undefined downstream.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: SessionUser }>();
    if (!req.user) {
      throw new InternalServerErrorException(
        'CurrentUser used on an unauthenticated route — guard it with SessionGuard',
      );
    }
    return req.user;
  },
);
