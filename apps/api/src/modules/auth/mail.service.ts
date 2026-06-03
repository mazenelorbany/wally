import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

import { AuthEnv } from './auth.config';

interface SendOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Thin Nodemailer wrapper. Dev points at Mailhog (no auth, no TLS, :1025);
 * prod points at a real SMTP relay with credentials + TLS.
 *
 * NEVER logs message bodies or recipient PII beyond the address + subject —
 * magic-link emails contain a session-issuing secret.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter!: Transporter;

  onModuleInit(): void {
    this.transporter = nodemailer.createTransport({
      host: AuthEnv.SMTP_HOST,
      port: AuthEnv.SMTP_PORT,
      secure: AuthEnv.SMTP_SECURE,
      ...(AuthEnv.SMTP_USER && AuthEnv.SMTP_PASSWORD
        ? { auth: { user: AuthEnv.SMTP_USER, pass: AuthEnv.SMTP_PASSWORD } }
        : {}),
    });
  }

  async send(options: SendOptions): Promise<void> {
    await this.transporter.sendMail({
      from: AuthEnv.MAIL_FROM,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html:
        options.html ??
        `<pre style="font-family:inherit">${escapeHtml(options.text)}</pre>`,
    });
    this.logger.debug(`mail sent → ${options.to} (${options.subject})`);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
