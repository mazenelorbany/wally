import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { Env } from './common/config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Swap Nest's default logger for pino (structured, redacting).
  app.useLogger(app.get(Logger));

  // Security headers. CSP disabled — this is a JSON API; the SPA is served
  // from a separate origin and sets its own policy.
  app.use(helmet({ contentSecurityPolicy: false }));

  // Session lives in an httpOnly cookie (SESSION_COOKIE_NAME). Parse it so the
  // auth guard can read it. Signing isn't needed — the session id is an opaque
  // hex token validated against the DB, not a tamperable payload.
  app.use(cookieParser());

  // Cookie-based sessions mean the browser must send credentials cross-origin,
  // so CORS is locked to the SPA origin (not "*") with credentials enabled.
  app.enableCors({
    origin: Env.APP_URL,
    credentials: true,
  });

  // Validation is zod-based per route (ZodValidationPipe), so no global
  // class-validator ValidationPipe — Wally doesn't depend on class-validator.

  // Health + signed-photo blob routes stay at the root; everything else is
  // namespaced under /api.
  app.setGlobalPrefix('api', { exclude: ['health'] });

  app.enableShutdownHooks();

  if (Env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Wally API')
      .setDescription('AI visual-merchandising compliance scoring for GRB retail (TCC).')
      .setVersion('0.1.0')
      .addCookieAuth(Env.SESSION_COOKIE_NAME)
      .build();
    const doc = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, doc, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(Env.PORT);

  // intentional — boot log.
  // eslint-disable-next-line no-console
  console.log(
    `[boot] Wally API listening on :${Env.PORT} (NODE_ENV=${Env.NODE_ENV})\n` +
      `  CORS origin   : ${Env.APP_URL}\n` +
      `  Vision model  : ${Env.WALLY_VISION_PROVIDER}/${Env.WALLY_VISION_MODEL ?? '(provider default)'}` +
      `${Env.WALLY_VISION_PROVIDER === 'anthropic' && !Env.ANTHROPIC_API_KEY ? ' (NO API KEY!)' : ''}\n` +
      `  Storage       : ${Env.WALLY_STORAGE_DRIVER} (${Env.WALLY_STORAGE_DIR})\n` +
      `  SMTP          : ${Env.SMTP_HOST}:${Env.SMTP_PORT}`,
  );
}

void bootstrap();
