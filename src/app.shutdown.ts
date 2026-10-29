import type { Server } from 'node:http';
import { Logger, type INestApplication } from '@nestjs/common';
import { closeHttpServer } from './common/http/close-server';
import { flushSentry } from './infra/sentry/sentry';
import { ShutdownState } from './infra/shutdown/shutdown.state';

export interface ShutdownOptions {
  // time between "not ready" and closing the server, so a load balancer can stop routing here
  drainMs: number;
  // hard deadline for the whole shutdown
  timeoutMs: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Order matters: /health/ready turns 503, we wait for the drain, in-flight requests finish, and
// only then the app closes (queue worker, Redis, database). Nest's own shutdown hooks are not
// enabled because they would close the database before the HTTP server stops.
export function registerGracefulShutdown(
  app: INestApplication,
  options: ShutdownOptions,
): void {
  const logger = new Logger('Shutdown');
  const state = app.get(ShutdownState);
  let started = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (started) return;
    started = true;
    logger.log(`${signal} received, shutting down gracefully`);

    const deadline = setTimeout(() => {
      logger.error(
        `Shutdown did not finish within ${options.timeoutMs} ms, forcing exit`,
      );
      process.exit(1);
    }, options.timeoutMs);
    deadline.unref();

    try {
      state.begin();
      if (options.drainMs > 0) await sleep(options.drainMs);
      await closeHttpServer(app.getHttpServer() as Server);
      await app.close();
      await flushSentry(2000);
      logger.log('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error(
        `Shutdown failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      process.exit(1);
    }
  };

  // "once": a second Ctrl+C during a stuck shutdown kills the process the normal way
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }
}
