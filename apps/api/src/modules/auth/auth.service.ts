import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { SessionUser } from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';

import { AuthEnv, magicLinkConsumeUrl } from './auth.config';
import {
  generateMagicToken,
  generateSessionId,
  isLikelyEmail,
  normalizeEmail,
  sha256,
} from './auth.crypto';
import { MailService } from './mail.service';
import type { GoogleProfile } from './strategies/google.strategy';

/** Shape returned by every session-minting path. The cookie value is `id`. */
export interface IssuedSession {
  id: string;
  expiresAt: Date;
  user: SessionUser;
}

interface IssueMagicLinkInput {
  email: string;
  orgId: string;
  storeId?: string;
  role?: Role;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // ─── Session lifecycle ────────────────────────────────────────────────

  /** Create a Session row (id = hex(randomBytes(32))) for an existing user.
   *  The returned `id` is what the caller drops into the session cookie. */
  async createSession(userId: string): Promise<IssuedSession> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const id = generateSessionId();
    const expiresAt = new Date(
      Date.now() + AuthEnv.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.prisma.session.create({
      data: { id, userId: user.id, expiresAt },
    });
    return { id, expiresAt, user: toSessionUser(user) };
  }

  /** Resolve the SessionUser behind a cookie value, or null if the session is
   *  unknown or expired. Expired rows are lazily deleted. Used by SessionGuard. */
  async resolveSession(sessionId: string): Promise<SessionUser | null> {
    if (!sessionId) return null;
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.prisma.session
        .delete({ where: { id: session.id } })
        .catch(() => undefined);
      return null;
    }
    return toSessionUser(session.user);
  }

  /** Delete a session row. Logout. Idempotent — a missing row is a no-op. */
  async destroySession(sessionId: string): Promise<void> {
    if (!sessionId) return;
    await this.prisma.session
      .delete({ where: { id: sessionId } })
      .catch(() => undefined);
  }

  // ─── Magic links ──────────────────────────────────────────────────────

  /**
   * Issue a magic-link invitation. Stores a single-use, short-TTL token as
   * sha256(raw) and emails the raw token as a link. The token carries the
   * org / store / role it was minted for; consume() materialises a User with
   * exactly that scope, which is how a store manager is invited to one store.
   *
   * The raw token only ever exists in this function and the outbound email.
   */
  async issueMagicLink(input: IssueMagicLinkInput): Promise<void> {
    const email = normalizeEmail(input.email);
    if (!isLikelyEmail(email)) {
      throw new BadRequestException('A valid email address is required');
    }
    const role = input.role ?? Role.STORE_MANAGER;

    const rawToken = generateMagicToken();
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(
      Date.now() + AuthEnv.MAGIC_LINK_TTL_MIN * 60 * 1000,
    );

    await this.prisma.magicLinkToken.create({
      data: {
        tokenHash,
        email,
        orgId: input.orgId,
        ...(input.storeId ? { storeId: input.storeId } : {}),
        role,
        expiresAt,
      },
    });

    // Points at the API's own consume route (not the SPA): a GET the API
    // handles directly — sets the session cookie, then 302s into the app.
    const url = magicLinkConsumeUrl(rawToken);

    await this.mail.send({
      to: email,
      subject: 'Your Wally sign-in link',
      text: magicLinkText(url, AuthEnv.MAGIC_LINK_TTL_MIN),
    });
    this.logger.debug(`magic link issued → ${email} (role=${role})`);
  }

  /**
   * Consume a raw magic-link token: hash it, atomically claim the unused +
   * unexpired row, upsert the User at the token's org/role, and mint a Session.
   *
   * Single-use is enforced with a conditional updateMany (usedAt: null in the
   * WHERE) so two concurrent consume() calls produce exactly one winner.
   */
  async consumeMagicLink(rawToken: string): Promise<IssuedSession> {
    if (!rawToken || rawToken.length < 16) {
      throw new UnauthorizedException('Invalid or expired link');
    }
    const tokenHash = sha256(rawToken);
    const now = new Date();

    // Atomic claim — usedAt + expiry are part of the WHERE so the loser of a
    // race sees count=0 and fails closed.
    const claim = await this.prisma.magicLinkToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claim.count === 0) {
      throw new UnauthorizedException('Invalid or expired link');
    }

    const token = await this.prisma.magicLinkToken.findUnique({
      where: { tokenHash },
    });
    if (!token) {
      // Vanished between the claim and the read — treat as failure.
      throw new UnauthorizedException('Invalid or expired link');
    }

    // Upsert the user at the token's scope. An existing user keeps their
    // current role (the invite shouldn't silently downgrade an admin); a new
    // user is created with the role the token was minted for.
    const user = await this.prisma.user.upsert({
      where: { email: token.email },
      update: {},
      create: {
        email: token.email,
        name: token.email.split('@')[0] ?? null,
        role: token.role,
        orgId: token.orgId,
      },
    });

    return this.createSession(user.id);
  }

  // ─── Google OAuth (reviewers) ─────────────────────────────────────────

  /**
   * Upsert a User from a verified Google profile (by googleId, falling back to
   * email) and mint a session. New Google users land as REVIEWER — the SSO
   * path is for internal reviewers, not store managers.
   *
   * Requires the profile's org to be resolvable: a brand-new Google user needs
   * an org to belong to. We resolve it from the email domain's existing users;
   * if none exists we reject rather than silently create an orphan org.
   */
  async googleLogin(profile: GoogleProfile): Promise<IssuedSession> {
    const email = normalizeEmail(profile.email);

    // Prefer an existing user matched by googleId, then by email.
    const existing =
      (await this.prisma.user.findUnique({ where: { googleId: profile.id } })) ??
      (await this.prisma.user.findUnique({ where: { email } }));

    let user;
    if (existing) {
      user = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          googleId: profile.id,
          ...(profile.name ? { name: profile.name } : {}),
        },
      });
    } else {
      // New SSO user: attach to the org their colleagues already belong to.
      const orgId = await this.resolveOrgForEmail(email);
      if (!orgId) {
        throw new UnauthorizedException(
          'No Wally organisation is provisioned for this account. ' +
            'Ask an admin to invite you first.',
        );
      }
      user = await this.prisma.user.create({
        data: {
          email,
          name: profile.name ?? (email.split('@')[0] ?? null),
          role: Role.REVIEWER,
          googleId: profile.id,
          orgId,
        },
      });
    }

    return this.createSession(user.id);
  }

  /** Resolve an org for a brand-new SSO user from existing same-domain users.
   *  Returns null when the domain has no foothold yet (we refuse to invent an
   *  org out of thin air on the OAuth path). */
  private async resolveOrgForEmail(email: string): Promise<string | null> {
    const domain = email.split('@')[1];
    if (!domain) return null;
    const sibling = await this.prisma.user.findFirst({
      where: { email: { endsWith: `@${domain}` } },
      orderBy: { createdAt: 'asc' },
      select: { orgId: true },
    });
    return sibling?.orgId ?? null;
  }

  // ─── Dev login (development only) ──────────────────────────────────────

  /**
   * DEV-ONLY: upsert a canonical demo user for the given role and mint a
   * session — lets a developer flip roles in one click without SMTP or SSO.
   * Hard-gated on NODE_ENV !== 'production'; the controller route is also
   * registered only in dev, so this is belt-and-braces.
   */
  async devLogin(role: Role): Promise<IssuedSession> {
    if (AuthEnv.NODE_ENV === 'production') {
      throw new UnauthorizedException('Dev login is disabled in production');
    }

    // Make sure a demo org exists to hang the user off of.
    const org = await this.prisma.org.upsert({
      where: { slug: 'dev' },
      update: {},
      create: { name: 'Dev Org', slug: 'dev' },
    });

    const email = `${role.toLowerCase()}@dev.local`;
    const user = await this.prisma.user.upsert({
      where: { email },
      update: { role, orgId: org.id },
      create: {
        email,
        name: `Dev ${titleCase(role)}`,
        role,
        orgId: org.id,
      },
    });

    this.logger.warn(`DEV LOGIN issued for ${email} (role=${role})`);
    return this.createSession(user.id);
  }
}

function toSessionUser(u: {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  orgId: string;
}): SessionUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    orgId: u.orgId,
  };
}

function titleCase(role: Role): string {
  return role
    .toLowerCase()
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function magicLinkText(url: string, ttlMin: number): string {
  return [
    'Hi,',
    '',
    'Click the link below to sign in to Wally:',
    '',
    `  ${url}`,
    '',
    `This link expires in ${ttlMin} minutes and can only be used once.`,
    '',
    "If you didn't request this, you can safely ignore this email.",
    '',
    '— Wally',
  ].join('\n');
}
