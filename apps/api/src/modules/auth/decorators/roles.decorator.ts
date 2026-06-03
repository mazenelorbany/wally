import { SetMetadata } from '@nestjs/common';
import type { Role } from '@prisma/client';

export const ROLES_KEY = 'requiredRoles';

/**
 * Restrict an endpoint to one or more roles. Enforced by RolesGuard, which
 * must run after SessionGuard (so req.user is populated).
 *
 *   @Roles('ADMIN', 'REVIEWER')
 *   @UseGuards(SessionGuard, RolesGuard)
 */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
