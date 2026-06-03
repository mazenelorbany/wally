import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type VerifyCallback } from 'passport-google-oauth20';

import { AuthEnv, googleCallbackUrl } from '../auth.config';

/** The slice of a Google profile we carry forward into googleLogin(). */
export interface GoogleProfile {
  id: string;
  email: string;
  name: string;
  /** Workspace hosted-domain claim, when present. */
  hd?: string;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    // This strategy is only registered when the OAuth credentials exist (see
    // auth.module.ts). If it's being constructed without them, fail loud at
    // construction with a clear message rather than letting passport throw on
    // the first request.
    if (!AuthEnv.GOOGLE_CLIENT_ID || !AuthEnv.GOOGLE_CLIENT_SECRET) {
      throw new Error(
        'GoogleStrategy requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. ' +
          'Configure them or remove GoogleStrategy from AuthModule.',
      );
    }
    super({
      clientID: AuthEnv.GOOGLE_CLIENT_ID,
      clientSecret: AuthEnv.GOOGLE_CLIENT_SECRET,
      callbackURL: googleCallbackUrl(),
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: {
      id: string;
      emails?: { value: string; verified?: boolean }[];
      displayName: string;
      _json?: { hd?: string };
    },
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new UnauthorizedException('Google profile has no email'), false);
      return;
    }

    const hd = profile._json?.hd;
    const allowed = AuthEnv.GOOGLE_ALLOWED_DOMAIN;
    if (allowed) {
      const emailDomain = email.split('@')[1]?.toLowerCase();
      if (hd !== allowed && emailDomain !== allowed) {
        done(
          new UnauthorizedException(
            `Only @${allowed} accounts are allowed (got ${email})`,
          ),
          false,
        );
        return;
      }
    }

    const result: GoogleProfile = {
      id: profile.id,
      email,
      name: profile.displayName,
      ...(hd ? { hd } : {}),
    };
    done(null, result);
  }
}
