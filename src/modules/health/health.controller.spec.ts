import { describe, expect, it, vi } from 'vitest';
import { AppException } from '../../common/errors/app.exception';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { RedisService } from '../../infra/redis/redis.service';
import { ShutdownState } from '../../infra/shutdown/shutdown.state';
import { HealthController } from './health.controller';

function build(
  dbUp: boolean,
  redisUp: boolean,
  shuttingDown = false,
): HealthController {
  const prisma = {
    $queryRaw: dbUp
      ? vi.fn().mockResolvedValue([{ ok: 1 }])
      : vi.fn().mockRejectedValue(new Error('db down')),
  } as unknown as PrismaService;
  const redis = {
    ping: vi.fn().mockResolvedValue(redisUp),
  } as unknown as RedisService;
  const shutdown = new ShutdownState();
  if (shuttingDown) shutdown.begin();
  return new HealthController(prisma, redis, shutdown);
}

describe('HealthController', () => {
  it('live returns ok', () => {
    expect(build(true, true).live()).toEqual({ status: 'ok' });
  });

  it('live stays ok while shutting down', () => {
    expect(build(true, true, true).live()).toEqual({ status: 'ok' });
  });

  it('ready returns ok when database and redis are up', async () => {
    await expect(build(true, true).ready()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('ready throws 503 with details when redis is down', async () => {
    const error = await build(true, false)
      .ready()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).getStatus()).toBe(503);
    expect((error as AppException).details).toEqual({
      database: 'up',
      redis: 'down',
    });
  });

  it('ready throws 503 when the database is down', async () => {
    await expect(build(false, true).ready()).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it('ready throws 503 SHUTTING_DOWN once shutdown has begun', async () => {
    const error = await build(true, true, true)
      .ready()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).code).toBe('SHUTTING_DOWN');
    expect((error as AppException).getStatus()).toBe(503);
  });
});
