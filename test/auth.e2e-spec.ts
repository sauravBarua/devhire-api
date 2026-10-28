/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment --
   supertest response bodies are untyped (any) */
import { execSync } from 'node:child_process';
import type { Server } from 'node:http';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Roles } from '../src/common/decorators/roles.decorator';
import { Role } from '../src/generated/prisma/enums';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { RedisService } from '../src/infra/redis/redis.service';

// test-only controller to exercise the global guards
@Controller('probe')
class ProbeController {
  @Get('any')
  any(): { ok: true } {
    return { ok: true };
  }

  @Roles(Role.ADMIN)
  @Get('admin')
  admin(): { ok: true } {
    return { ok: true };
  }
}

const API = '/api/v1';
const password = 'Passw0rd!test';

let app: INestApplication;
let container: StartedPostgreSqlContainer;

const http = () => request(app.getHttpServer() as Server);

function refreshCookie(res: { headers: Record<string, unknown> }): string {
  const header = res.headers['set-cookie'];
  const cookies = Array.isArray(header) ? (header as string[]) : [];
  const raw = cookies.find((c) => c.startsWith('refresh_token='));
  if (!raw) throw new Error('refresh_token cookie not set');
  return raw.split(';')[0];
}

const register = (
  email: string,
  role: 'CANDIDATE' | 'RECRUITER' = 'CANDIDATE',
) =>
  http()
    .post(`${API}/auth/register`)
    .send({ email, password, firstName: 'Test', lastName: 'User', role });

const login = (email: string, pwd = password) =>
  http().post(`${API}/auth/login`).send({ email, password: pwd });

const refresh = (cookie?: string) => {
  const req = http().post(`${API}/auth/refresh`);
  return cookie ? req.set('Cookie', cookie) : req;
};

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
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

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ProbeController],
  })
    .overrideProvider(RedisService)
    .useValue({ ping: () => Promise.resolve(true) })
    .compile();

  app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();

  await app.get(PrismaService).user.create({
    data: {
      email: 'admin@example.com',
      passwordHash: await bcrypt.hash(password, 4),
      firstName: 'Ada',
      lastName: 'Admin',
      role: Role.ADMIN,
    },
  });
});

afterAll(async () => {
  await app?.close();
  await container?.stop();
});

describe('POST /auth/register', () => {
  it('creates a candidate, normalizes the email and sets an httpOnly refresh cookie', async () => {
    const res = await register('Alice@Example.com');
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email: 'alice@example.com',
      role: 'CANDIDATE',
    });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(typeof res.body.accessToken).toBe('string');
    const setCookie = (res.headers['set-cookie'] as unknown as string[]).join(
      ';',
    );
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Path=/api/v1/auth');
  });

  it('rejects a duplicate email (case-insensitive)', async () => {
    const res = await register('ALICE@example.com');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('AUTH_EMAIL_TAKEN');
  });

  it('rejects the ADMIN role', async () => {
    const res = await http().post(`${API}/auth/register`).send({
      email: 'x@example.com',
      password,
      firstName: 'X',
      lastName: 'Y',
      role: 'ADMIN',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a short password', async () => {
    const res = await http().post(`${API}/auth/register`).send({
      email: 'short@example.com',
      password: 'abc',
      firstName: 'X',
      lastName: 'Y',
      role: 'CANDIDATE',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /auth/login', () => {
  it('logs in with valid credentials', async () => {
    const res = await login('alice@example.com');
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(refreshCookie(res)).toMatch(/^refresh_token=/);
  });

  it('rejects a wrong password', async () => {
    const res = await login('alice@example.com', 'wrong-password');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('returns the same error for an unknown email', async () => {
    const res = await login('nobody@example.com');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });
});

describe('GET /auth/me', () => {
  it('rejects a request without a token', async () => {
    const res = await http().get(`${API}/auth/me`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_UNAUTHORIZED');
  });

  it('returns the current user', async () => {
    const { body } = await login('alice@example.com');
    const res = await http()
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('alice@example.com');
  });
});

describe('POST /auth/refresh and /auth/logout', () => {
  it('rotates the refresh token', async () => {
    const first = refreshCookie(await login('alice@example.com'));
    const res = await refresh(first);
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(refreshCookie(res)).not.toBe(first);
  });

  it('revokes the whole family when a rotated token is reused', async () => {
    const first = refreshCookie(await login('alice@example.com'));
    const second = refreshCookie(await refresh(first));

    const reused = await refresh(first);
    expect(reused.status).toBe(401);
    expect(reused.body.code).toBe('AUTH_REFRESH_REUSED');

    expect((await refresh(second)).status).toBe(401);
  });

  it('rejects a request without a refresh cookie', async () => {
    const res = await refresh();
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REFRESH_INVALID');
  });

  it('logout returns 204 and invalidates the refresh token', async () => {
    const cookie = refreshCookie(await login('alice@example.com'));
    const out = await http().post(`${API}/auth/logout`).set('Cookie', cookie);
    expect(out.status).toBe(204);
    expect((await refresh(cookie)).status).toBe(401);
  });
});

describe('role guard', () => {
  it('rejects a candidate on an admin route', async () => {
    const { body } = await login('alice@example.com');
    const res = await http()
      .get(`${API}/probe/admin`)
      .set('Authorization', `Bearer ${body.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AUTH_FORBIDDEN');
  });

  it('allows an admin on an admin route', async () => {
    const { body } = await login('admin@example.com');
    const res = await http()
      .get(`${API}/probe/admin`)
      .set('Authorization', `Bearer ${body.accessToken}`);
    expect(res.status).toBe(200);
  });

  it('requires authentication on routes that are not public', async () => {
    const res = await http().get(`${API}/probe/any`);
    expect(res.status).toBe(401);
  });
});

describe('public routes', () => {
  it('health/live needs no token', async () => {
    const res = await http().get(`${API}/health/live`);
    expect(res.status).toBe(200);
  });
});
