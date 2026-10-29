import { execSync } from 'node:child_process';
import type { Server } from 'node:http';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

export interface Override {
  provide: Type<unknown>;
  useValue: unknown;
}

export interface TestApp {
  app: INestApplication;
  close: () => Promise<void>;
}

export const TEST_PASSWORD = 'Passw0rd!test';

// starts throwaway Postgres + Redis, applies migrations and boots the real AppModule
export async function createTestApp(
  overrides: Override[] = [],
): Promise<TestApp> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);
  const databaseUrl = postgres.getConnectionUri();

  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redis.getConnectionUrl(),
    JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-1234',
    BCRYPT_ROUNDS: '4',
    JOB_DEFAULT_EXPIRY_DAYS: '30',
    JOB_EXPIRY_REMINDER_DAYS: '3',
    QUEUE_BACKOFF_MS: '50',
    WEB_URL: 'http://localhost:3001',
  });

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  let builder = Test.createTestingModule({ imports: [AppModule] });
  for (const override of overrides) {
    builder = builder
      .overrideProvider(override.provide)
      .useValue(override.useValue);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  // listen once on a random port so concurrent supertest requests share one server
  await app.listen(0);

  return {
    app,
    close: async () => {
      await app.close();
      await Promise.all([postgres.stop(), redis.stop()]);
    },
  };
}

export async function signup(
  app: INestApplication,
  email: string,
  role: 'CANDIDATE' | 'RECRUITER',
): Promise<{ token: string; id: string }> {
  const res = await request(app.getHttpServer() as Server)
    .post('/api/v1/auth/register')
    .send({
      email,
      password: TEST_PASSWORD,
      firstName: 'Test',
      lastName: 'User',
      role,
    });
  const body = res.body as { accessToken: string; user: { id: string } };
  return { token: body.accessToken, id: body.user.id };
}
