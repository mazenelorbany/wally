import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Opt a route out of the globally-registered SessionGuard. Use on the
 *  unauthenticated auth endpoints (magic-link request/consume, google, etc.). */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
