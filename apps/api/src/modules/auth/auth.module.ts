import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';

import { googleOAuthConfigured } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MailService } from './mail.service';
import { RolesGuard } from './roles.guard';
import { SessionGuard } from './session.guard';
import { GoogleStrategy } from './strategies/google.strategy';

/**
 * AuthModule — magic-link + Google OAuth + session-cookie auth for Wally.
 *
 * Wally is the TRIMMED stack: NO Redis, NO JWT bearer tokens. A session is a
 * plain Postgres row whose primary key (hex(randomBytes(32))) is the httpOnly
 * cookie value, so the cookie itself is the only secret. Magic-link tokens are
 * stored sha256-hashed and are single-use.
 *
 * Guard strategy (fail-closed):
 *   - SessionGuard is registered GLOBALLY (APP_GUARD), so every route is
 *     authenticated by default and must opt out with @Public(). The auth
 *     endpoints that have to be reachable without a session (magic-link
 *     request/consume, google start/callback, dev-login, logout) carry it.
 *   - RolesGuard is opt-in — applied per route with @UseGuards(RolesGuard)
 *     alongside @Roles(...). It's exported so the resource modules can use it.
 *
 * Google OAuth is optional. The strategy + its env-dependent constructor are
 * only registered when both credentials are present (googleOAuthConfigured),
 * so the API boots fine with SSO unconfigured — magic-link auth still works.
 */
// Global so the resource modules' @UseGuards(SessionGuard|RolesGuard) and any
// AuthService injection resolve without each importing AuthModule.
@Global()
@Module({
  imports: [PassportModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    MailService,
    SessionGuard,
    RolesGuard,
    // Authenticate every route by default; @Public() opts specific ones out.
    { provide: APP_GUARD, useClass: SessionGuard },
    // GoogleStrategy's constructor throws when its credentials are missing, so
    // only register it once they're actually configured — otherwise the whole
    // process would crash on boot in a magic-link-only deployment.
    ...(googleOAuthConfigured() ? [GoogleStrategy] : []),
  ],
  exports: [
    // Per the NEST MODULE NAME CONTRACT: export the providers we share. The
    // resource modules inject SessionGuard / RolesGuard via @UseGuards and may
    // call AuthService (e.g. issuing store-manager invites).
    AuthService,
    SessionGuard,
    RolesGuard,
  ],
})
export class AuthModule {}
