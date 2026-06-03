import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCookieAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Role } from '@prisma/client';
import type { CookieOptions, Request, Response } from 'express';
import type { SessionUser } from '@wally/types';

import { ZodValidationPipe } from '../org/zod-validation.pipe';

import { AuthEnv } from './auth.config';
import {
  DevLoginSchema,
  MagicLinkRequestSchema,
  type DevLoginInput,
  type MagicLinkRequestInput,
} from './auth.dto';
import { AuthService, type IssuedSession } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import type { GoogleProfile } from './strategies/google.strategy';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // ── Magic link ────────────────────────────────────────────────────────

  /**
   * Request a magic-link email. Always answers 202 — never confirm or deny
   * that an account exists to an unauthenticated caller (enumeration defence).
   * The service itself never throws on "no such user"; it materialises one on
   * consume. Tightly throttled to blunt link-spamming an inbox.
   */
  @Public()
  @Throttle({ global: { ttl: 60_000, limit: 5 } })
  @Post('magic-link/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Email a single-use magic sign-in link.' })
  async requestMagicLink(
    @Body(new ZodValidationPipe(MagicLinkRequestSchema)) dto: MagicLinkRequestInput,
  ): Promise<{ ok: true }> {
    await this.auth.issueMagicLink({
      email: dto.email,
      orgId: dto.orgId,
      ...(dto.storeId ? { storeId: dto.storeId } : {}),
      ...(dto.role ? { role: dto.role as Role } : {}),
    });
    return { ok: true };
  }

  /**
   * Consume a magic-link token: mint a session, set the cookie, redirect into
   * the SPA. The token arrives as a query param because the link is clicked
   * from an email — there's no body to POST.
   *
   * On any failure we redirect to the SPA login surface with a generic error
   * flag rather than rendering a raw 401 — invalid, expired, and already-used
   * all look identical so we don't leak which it was.
   */
  @Public()
  @Throttle({ global: { ttl: 60_000, limit: 20 } })
  @Get('magic-link/consume')
  @ApiOperation({
    summary: 'Consume a magic-link token, set the session cookie, redirect to the app.',
  })
  async consumeMagicLink(
    @Query('token') token: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    try {
      const session = await this.auth.consumeMagicLink(token);
      this.setSessionCookie(res, session);
      res.redirect(this.appUrl('/'));
    } catch {
      res.redirect(this.appUrl('/login?error=link_invalid'));
    }
  }

  // ── Google OAuth (reviewers) ──────────────────────────────────────────

  /**
   * Kick off the Google OAuth dance. The passport guard issues the redirect to
   * Google's consent screen, so this handler body is never reached. Only
   * usable when OAuth credentials are configured (otherwise the strategy isn't
   * registered and AuthGuard('google') 500s — which is the intended "SSO not
   * set up" signal).
   */
  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Begin Google OAuth (redirects to Google consent).' })
  startGoogle(): void {
    /* passport redirects; unreachable */
  }

  /**
   * OAuth callback. Passport has validated the profile and attached it to
   * req.user; we upsert the reviewer, mint a session, set the cookie, and
   * redirect into the SPA.
   */
  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth callback — sets the session cookie and redirects.' })
  async googleCallback(
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const profile = req.user as GoogleProfile | undefined;
    if (!profile) {
      res.redirect(this.appUrl('/login?error=oauth_failed'));
      return;
    }
    try {
      const session = await this.auth.googleLogin(profile);
      this.setSessionCookie(res, session);
      res.redirect(this.appUrl('/'));
    } catch {
      // e.g. no org provisioned for this Google account.
      res.redirect(this.appUrl('/login?error=no_org'));
    }
  }

  // ── Dev login (development only) ──────────────────────────────────────

  /**
   * DEV-ONLY: mint a session for a canonical demo user of the given role so a
   * developer can flip roles in one click without SMTP or SSO. Hard-gated: the
   * handler refuses in production before touching the service (which also
   * re-checks NODE_ENV), and the route is excluded from the Swagger doc.
   */
  @Public()
  @Post('dev-login')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async devLogin(
    @Body(new ZodValidationPipe(DevLoginSchema)) dto: DevLoginInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionUser> {
    if (AuthEnv.NODE_ENV === 'production') {
      throw new UnauthorizedException('Dev login is disabled in production');
    }
    const session = await this.auth.devLogin(dto.role as Role);
    this.setSessionCookie(res, session);
    return session.user;
  }

  // ── Session lifecycle ─────────────────────────────────────────────────

  /**
   * Log out: delete the session row (so the cookie value is dead even if it
   * has already leaked) and clear the cookie. Public + idempotent — safe to
   * call with no session, and we don't want a stale/expired session to block
   * the user from clearing it.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Destroy the current session and clear the cookie.' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const sessionId = this.readSessionCookie(req);
    if (sessionId) await this.auth.destroySession(sessionId);
    this.clearSessionCookie(res);
  }

  /** Return the authenticated user. Guarded by the global SessionGuard, so a
   *  missing / expired session 401s before reaching this handler. */
  @Get('me')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Return the currently authenticated user.' })
  me(@CurrentUser() user: SessionUser): SessionUser {
    return user;
  }

  // ── Cookie helpers ────────────────────────────────────────────────────

  /** Shared cookie attributes. httpOnly (no JS access to the session secret),
   *  sameSite=lax (so the top-level magic-link / OAuth redirect still carries
   *  the cookie), secure from env (true behind TLS in prod), path=/ (sent on
   *  every API route). */
  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: AuthEnv.SESSION_COOKIE_SECURE,
      path: '/',
    };
  }

  private setSessionCookie(res: Response, session: IssuedSession): void {
    res.cookie(AuthEnv.SESSION_COOKIE_NAME, session.id, {
      ...this.cookieOptions(),
      // Keep the cookie's lifetime in lockstep with the DB row's expiry.
      expires: session.expiresAt,
    });
  }

  private clearSessionCookie(res: Response): void {
    res.clearCookie(AuthEnv.SESSION_COOKIE_NAME, this.cookieOptions());
  }

  private readSessionCookie(req: Request): string | undefined {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    return cookies?.[AuthEnv.SESSION_COOKIE_NAME];
  }

  /** Build an absolute URL into the SPA from a path. */
  private appUrl(path: string): string {
    return new URL(path, AuthEnv.APP_URL).toString();
  }
}
