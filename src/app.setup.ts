import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import type { Env } from './config/env';
import { setupDocs } from './openapi/openapi';

// Swagger UI needs a looser Content-Security-Policy than a JSON API, and helmet's default
// "upgrade-insecure-requests" would break it on plain-http localhost. Every other route keeps the defaults.
function createHelmet(): (
  req: Request,
  res: Response,
  next: NextFunction,
) => void {
  const strict = helmet();
  const docs = helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'upgrade-insecure-requests': null,
        'script-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'https:'],
      },
    },
  });
  return (req, res, next) =>
    (req.path.startsWith('/docs') ? docs : strict)(req, res, next);
}

// shared by main.ts and the e2e tests so both run the same HTTP setup
export function configureApp(app: NestExpressApplication, env: Env): void {
  // behind Nginx the client IP comes from X-Forwarded-For, which throttling needs
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);

  app.use(createHelmet());
  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());

  if (env.DOCS_ENABLED ?? env.NODE_ENV !== 'production') {
    try {
      setupDocs(app);
    } catch (error) {
      // the API must keep running even if its documentation cannot be generated
      new Logger('OpenAPI').warn(
        `API docs disabled: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
