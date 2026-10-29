/* eslint-disable @typescript-eslint/no-unsafe-member-access --
   supertest response bodies are untyped (any) */
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { ShutdownState } from '../src/infra/shutdown/shutdown.state';
import { RefreshTokenCleanupService } from '../src/modules/auth/refresh-token-cleanup.service';
import { createTestApp, signup, type TestApp } from './support/test-app';

const API = '/api/v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_ORIGIN = 'http://localhost:3001';
const SECOND_ORIGIN = 'https://app.example.test';

let testApp: TestApp;
let app: INestApplication;
let candidate: { token: string; id: string };
let recruiter: { token: string; id: string };

const http = () => request(app.getHttpServer() as Server);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  // general limit 5 and strict limit 4 per route and minute; CORS with a trailing-slash entry on purpose
  testApp = await createTestApp([], {
    THROTTLE_LIMIT: '5',
    THROTTLE_STRICT_LIMIT: '4',
    CORS_ORIGINS: `${ALLOWED_ORIGIN},${SECOND_ORIGIN}/`,
  });
  app = testApp.app;
  candidate = await signup(app, 'candidate@example.com', 'CANDIDATE');
  recruiter = await signup(app, 'recruiter@example.com', 'RECRUITER');
});

afterAll(async () => {
  await testApp?.close();
});

describe('security headers', () => {
  it('sets helmet headers and hides the framework', async () => {
    const res = await http().get(`${API}/health/live`);
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toBeDefined();
  });
});

describe('CORS', () => {
  it('allows listed origins with credentials', async () => {
    for (const origin of [ALLOWED_ORIGIN, SECOND_ORIGIN]) {
      const res = await http().get(`${API}/health/live`).set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    }
  });

  it('does not allow other origins', async () => {
    const res = await http()
      .get(`${API}/health/live`)
      .set('Origin', 'https://evil.example.test');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers a preflight for a listed origin only', async () => {
    const ok = await http()
      .options(`${API}/auth/login`)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,authorization');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-methods']).toContain('POST');
    expect(ok.headers['access-control-allow-headers']).toContain(
      'Authorization',
    );

    const bad = await http()
      .options(`${API}/auth/login`)
      .set('Origin', 'https://evil.example.test')
      .set('Access-Control-Request-Method', 'POST');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('origin check on cookie endpoints', () => {
  it('refuses a foreign Origin on logout', async () => {
    const res = await http()
      .post(`${API}/auth/logout`)
      .set('Origin', 'https://evil.example.test');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AUTH_ORIGIN_FORBIDDEN');
  });

  it('accepts a listed Origin and requests without Origin', async () => {
    expect(
      (await http().post(`${API}/auth/logout`).set('Origin', ALLOWED_ORIGIN))
        .status,
    ).toBe(204);
    expect((await http().post(`${API}/auth/logout`)).status).toBe(204);
  });
});

describe('JWT algorithm pinning', () => {
  it('accepts a normal token', async () => {
    const res = await http().get(`${API}/auth/me`).set(bearer(candidate.token));
    expect(res.status).toBe(200);
  });

  it('rejects a token signed with another algorithm, even with the right secret', async () => {
    const forged = await app
      .get(JwtService)
      .signAsync({ sub: candidate.id, role: 'ADMIN' }, { algorithm: 'HS384' });
    const res = await http().get(`${API}/auth/me`).set(bearer(forged));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_UNAUTHORIZED');
  });
});

describe('upload limits', () => {
  it('rejects a logo upload with too many form fields', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32),
    ]);
    const res = await http()
      .post(`${API}/companies/me/logo`)
      .set(bearer(recruiter.token))
      .field('a', '1')
      .field('b', '2')
      .field('c', '3')
      .attach('file', png, { filename: 'logo.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });
});

describe('throttling', () => {
  it('limits strict routes (login) per client and returns the standard error shape', async () => {
    const attempt = () =>
      http()
        .post(`${API}/auth/login`)
        .send({ email: 'nobody@example.com', password: 'wrong-password' });

    for (let i = 0; i < 4; i += 1) {
      expect((await attempt()).status).toBe(401);
    }
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('TOO_MANY_REQUESTS');
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('limits normal routes with the general limit', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await http().get(`${API}/skills`)).status).toBe(200);
    }
    const blocked = await http().get(`${API}/skills`);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('TOO_MANY_REQUESTS');
  });

  it('never throttles the health endpoints', async () => {
    for (let i = 0; i < 12; i += 1) {
      expect((await http().get(`${API}/health/live`)).status).toBe(200);
    }
  });
});

describe('refresh token cleanup', () => {
  it('deletes tokens expired for more than a day and keeps the rest', async () => {
    const prisma = app.get(PrismaService);
    const make = (name: string, expiresAt: Date) => ({
      userId: candidate.id,
      tokenHash: `hash-${name}`,
      familyId: `family-${name}`,
      expiresAt,
    });
    await prisma.refreshToken.createMany({
      data: [
        make('old-1', new Date(Date.now() - 3 * DAY_MS)),
        make('old-2', new Date(Date.now() - 2 * DAY_MS)),
        make('just-expired', new Date(Date.now() - 60 * 60 * 1000)),
        make('valid', new Date(Date.now() + 5 * DAY_MS)),
      ],
    });

    const removed = await app
      .get(RefreshTokenCleanupService)
      .purgeExpiredTokens();
    expect(removed).toBe(2);

    const left = (
      await prisma.refreshToken.findMany({ where: { userId: candidate.id } })
    ).map((t) => t.tokenHash);
    expect(left).toContain('hash-just-expired');
    expect(left).toContain('hash-valid');
    expect(left).not.toContain('hash-old-1');
    expect(left).not.toContain('hash-old-2');
  });
});

describe('graceful shutdown', () => {
  it('turns readiness to 503 once shutdown begins, while liveness stays 200', async () => {
    expect((await http().get(`${API}/health/ready`)).status).toBe(200);

    app.get(ShutdownState).begin();

    const ready = await http().get(`${API}/health/ready`);
    expect(ready.status).toBe(503);
    expect(ready.body.code).toBe('SHUTTING_DOWN');
    expect((await http().get(`${API}/health/live`)).status).toBe(200);
  });
});
