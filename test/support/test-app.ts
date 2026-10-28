import { execSync } from 'node:child_process';
import type { Server } from 'node:http';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { RedisService } from '../../src/infra/redis/redis.service';

export interface Override {
  provide: Type<unknown>;
  useValue: unknown;
}

export interface TestApp {
  app: INestApplication;
  close: () => Promise<void>;
}

export const TEST_PASSWORD = 'Passw0rd!test';

// starts a throwaway Postgres, applies migrations and boots the real AppModule
export async function createTestApp(
  overrides: Override[] = [],
): Promise<TestApp> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const databaseUrl = container.getConnectionUri();

  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: databaseUrl,
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-1234',
    BCRYPT_ROUNDS: '4',
  });

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RedisService)
    .useValue({ ping: () => Promise.resolve(true) });
  for (const override of overrides) {
    builder = builder
      .overrideProvider(override.provide)
      .useValue(override.useValue);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();

  return {
    app,
    close: async () => {
      await app.close();
      await container.stop();
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
