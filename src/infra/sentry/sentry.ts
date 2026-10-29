import * as Sentry from '@sentry/node';
import type { Env } from '../../config/env';

interface ScrubbableEvent {
  message?: string;
  request?: {
    cookies?: unknown;
    data?: unknown;
    headers?: Record<string, unknown>;
  };
  user?: unknown;
}

// never ship cookies, tokens, request bodies or user identity to a third party
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.cookie;
    }
  }
  delete event.user;
  return event;
}

export function initSentry(env: Env): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
  return true;
}

// a no-op when Sentry is not initialised
export function captureServerError(error: unknown): void {
  Sentry.captureException(error);
}

export async function flushSentry(timeoutMs: number): Promise<void> {
  await Sentry.close(timeoutMs);
}
