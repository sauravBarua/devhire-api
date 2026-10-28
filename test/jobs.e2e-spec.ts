/* eslint-disable @typescript-eslint/no-unsafe-member-access --
   supertest response bodies are untyped (any) */
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobStatus } from '../src/generated/prisma/enums';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { SKILLS } from '../src/modules/skills/skills.data';
import { createTestApp, signup, type TestApp } from './support/test-app';

const API = '/api/v1';
const DAY_MS = 24 * 60 * 60 * 1000;

const jobBody = {
  title: 'Développeur Node.js senior',
  description:
    'Rejoignez une équipe produit pour construire des API fiables et maintenables.',
  category: 'BACKEND',
  contractType: 'CDI',
  remotePolicy: 'HYBRID',
  experienceLevel: 'SENIOR',
  city: 'Paris',
  salaryMin: 50000,
  salaryMax: 70000,
  skills: ['nodejs', 'typescript'],
};

const events: Array<{ name: string; jobId: string }> = [];

let testApp: TestApp;
let app: INestApplication;
let prisma: PrismaService;
let recruiterA: { token: string; id: string };
let recruiterB: { token: string; id: string };
let recruiterNoCompany: { token: string; id: string };
let candidate: { token: string; id: string };
let jobId: string;

const http = () => request(app.getHttpServer() as Server);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const createJob = (token: string, body: object = jobBody) =>
  http().post(`${API}/recruiter/jobs`).set(bearer(token)).send(body);
const action = (
  token: string,
  id: string,
  name: 'publish' | 'close' | 'renew',
) => http().post(`${API}/recruiter/jobs/${id}/${name}`).set(bearer(token));
const getJob = (token: string, id: string) =>
  http().get(`${API}/recruiter/jobs/${id}`).set(bearer(token));

beforeAll(async () => {
  testApp = await createTestApp();
  app = testApp.app;
  prisma = app.get(PrismaService);
  await prisma.skill.createMany({ data: SKILLS });

  recruiterA = await signup(app, 'recruiter.a@example.com', 'RECRUITER');
  recruiterB = await signup(app, 'recruiter.b@example.com', 'RECRUITER');
  recruiterNoCompany = await signup(
    app,
    'recruiter.none@example.com',
    'RECRUITER',
  );
  candidate = await signup(app, 'candidate@example.com', 'CANDIDATE');

  await http()
    .post(`${API}/companies`)
    .set(bearer(recruiterA.token))
    .send({ name: 'Company A' });
  await http()
    .post(`${API}/companies`)
    .set(bearer(recruiterB.token))
    .send({ name: 'Company B' });

  const emitter = app.get(EventEmitter2);
  for (const name of [
    'job.published',
    'job.closed',
    'job.expired',
    'job.renewed',
  ]) {
    emitter.on(name, (payload: { jobId: string }) =>
      events.push({ name, jobId: payload.jobId }),
    );
  }
});

afterAll(async () => {
  await testApp?.close();
});

describe('access', () => {
  it('requires authentication', async () => {
    expect((await http().get(`${API}/recruiter/jobs`)).status).toBe(401);
  });

  it('forbids candidates', async () => {
    const res = await http()
      .get(`${API}/recruiter/jobs`)
      .set(bearer(candidate.token));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AUTH_FORBIDDEN');
  });

  it('requires a company profile', async () => {
    const res = await createJob(recruiterNoCompany.token);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('COMPANY_REQUIRED');
  });
});

describe('create', () => {
  it('creates a DRAFT job with its skills', async () => {
    const res = await createJob(recruiterA.token);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'DRAFT',
      publishedAt: null,
      expiresAt: null,
      closedAt: null,
      postedDaysAgo: null,
      city: 'Paris',
      category: 'BACKEND',
    });
    expect(
      (res.body.skills as Array<{ slug: string }>).map((s) => s.slug),
    ).toEqual(['nodejs', 'typescript']);
    jobId = res.body.id as string;
  });

  it('rejects unknown skills', async () => {
    const res = await createJob(recruiterA.token, {
      ...jobBody,
      skills: ['nodejs', 'nope'],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SKILL_NOT_FOUND');
    expect(res.body.details.unknown).toEqual(['nope']);
  });

  it('rejects salaryMin above salaryMax', async () => {
    const res = await createJob(recruiterA.token, {
      ...jobBody,
      salaryMin: 90000,
      salaryMax: 50000,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a short title and an invalid enum', async () => {
    expect(
      (await createJob(recruiterA.token, { ...jobBody, title: 'Hi' })).status,
    ).toBe(400);
    const badEnum = await createJob(recruiterA.token, {
      ...jobBody,
      category: 'COOKING',
    });
    expect(badEnum.status).toBe(400);
    expect(badEnum.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('read and update', () => {
  it('returns an own job', async () => {
    const res = await getJob(recruiterA.token, jobId);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(jobId);
  });

  it("hides another company's job behind a 404", async () => {
    const res = await getJob(recruiterB.token, jobId);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('JOB_NOT_FOUND');
  });

  it('updates fields, replaces skills and clears a field with null', async () => {
    const res = await http()
      .patch(`${API}/recruiter/jobs/${jobId}`)
      .set(bearer(recruiterA.token))
      .send({
        title: 'Développeur NestJS senior',
        city: null,
        skills: ['nestjs'],
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      title: 'Développeur NestJS senior',
      city: null,
      salaryMin: 50000,
    });
    expect(
      (res.body.skills as Array<{ slug: string }>).map((s) => s.slug),
    ).toEqual(['nestjs']);
  });

  it('checks the salary range against stored values', async () => {
    const res = await http()
      .patch(`${API}/recruiter/jobs/${jobId}`)
      .set(bearer(recruiterA.token))
      .send({ salaryMax: 1000 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it("refuses to update another company's job", async () => {
    const res = await http()
      .patch(`${API}/recruiter/jobs/${jobId}`)
      .set(bearer(recruiterB.token))
      .send({ title: 'Hijacked title' });
    expect(res.status).toBe(404);
  });
});

describe('lifecycle', () => {
  let firstPublishedAt: string;
  let firstExpiresAt: string;

  it("refuses to publish another company's job", async () => {
    expect((await action(recruiterB.token, jobId, 'publish')).status).toBe(404);
  });

  it('publishes a DRAFT: sets publishedAt and expiresAt = +30 days', async () => {
    const res = await action(recruiterA.token, jobId, 'publish');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PUBLISHED');
    expect(res.body.closedAt).toBeNull();
    expect(res.body.postedDaysAgo).toBe(0);
    const published = new Date(res.body.publishedAt as string).getTime();
    const expires = new Date(res.body.expiresAt as string).getTime();
    expect(expires - published).toBe(30 * DAY_MS);
    firstPublishedAt = res.body.publishedAt as string;
    firstExpiresAt = res.body.expiresAt as string;
  });

  it('rejects publishing again, renewing a published job and deleting it', async () => {
    const again = await action(recruiterA.token, jobId, 'publish');
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('JOB_INVALID_TRANSITION');

    const renew = await action(recruiterA.token, jobId, 'renew');
    expect(renew.status).toBe(409);
    expect(renew.body.code).toBe('JOB_INVALID_TRANSITION');

    const del = await http()
      .delete(`${API}/recruiter/jobs/${jobId}`)
      .set(bearer(recruiterA.token));
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('JOB_DELETE_NOT_ALLOWED');
  });

  it('closes a PUBLISHED job and sets closedAt', async () => {
    const res = await action(recruiterA.token, jobId, 'close');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CLOSED');
    expect(res.body.closedAt).not.toBeNull();
    expect(res.body.publishedAt).toBe(firstPublishedAt);
    expect(res.body.expiresAt).toBe(firstExpiresAt);
  });

  it('rejects closing or publishing a CLOSED job', async () => {
    expect((await action(recruiterA.token, jobId, 'close')).status).toBe(409);
    expect((await action(recruiterA.token, jobId, 'publish')).status).toBe(409);
  });

  it('renews a CLOSED job: keeps publishedAt, new expiresAt, closedAt cleared', async () => {
    const res = await action(recruiterA.token, jobId, 'renew');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PUBLISHED');
    expect(res.body.publishedAt).toBe(firstPublishedAt);
    expect(res.body.closedAt).toBeNull();
    expect(new Date(res.body.expiresAt as string).getTime()).toBeGreaterThan(
      new Date(firstExpiresAt).getTime(),
    );
  });

  it('renews an EXPIRED job and rejects closing it', async () => {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.EXPIRED,
        closedAt: new Date(),
        expiresAt: new Date(Date.now() - DAY_MS),
      },
    });

    expect((await action(recruiterA.token, jobId, 'close')).status).toBe(409);

    const res = await action(recruiterA.token, jobId, 'renew');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PUBLISHED');
    expect(res.body.publishedAt).toBe(firstPublishedAt);
    expect(res.body.closedAt).toBeNull();
    expect(new Date(res.body.expiresAt as string).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it('rejects closing or renewing a DRAFT', async () => {
    const draft = await createJob(recruiterA.token);
    const id = draft.body.id as string;
    expect((await action(recruiterA.token, id, 'close')).status).toBe(409);
    expect((await action(recruiterA.token, id, 'renew')).status).toBe(409);
    expect((await getJob(recruiterA.token, id)).body.status).toBe('DRAFT');
  });

  it('emitted one event per successful transition and none for rejected ones', () => {
    expect(events.filter((e) => e.jobId === jobId).map((e) => e.name)).toEqual([
      'job.published',
      'job.closed',
      'job.renewed',
      'job.renewed',
    ]);
  });
});

describe('delete', () => {
  it('deletes a DRAFT job', async () => {
    const draft = await createJob(recruiterA.token);
    const id = draft.body.id as string;
    const del = await http()
      .delete(`${API}/recruiter/jobs/${id}`)
      .set(bearer(recruiterA.token));
    expect(del.status).toBe(204);
    expect((await getJob(recruiterA.token, id)).status).toBe(404);
  });
});

describe('list', () => {
  it('returns only the own company jobs, filtered by status', async () => {
    const published = await http()
      .get(`${API}/recruiter/jobs?status=PUBLISHED`)
      .set(bearer(recruiterA.token));
    expect(published.status).toBe(200);
    const items = published.body.items as Array<{ id: string; status: string }>;
    expect(items.every((job) => job.status === 'PUBLISHED')).toBe(true);
    expect(items.map((job) => job.id)).toContain(jobId);

    const other = await http()
      .get(`${API}/recruiter/jobs`)
      .set(bearer(recruiterB.token));
    expect(other.body.items).toEqual([]);
  });

  it('paginates with a cursor without duplicates or gaps', async () => {
    for (let i = 0; i < 3; i += 1) {
      const res = await createJob(recruiterA.token, {
        ...jobBody,
        title: `Pagination job ${i}`,
      });
      expect(res.status).toBe(201);
    }

    const all = await http()
      .get(`${API}/recruiter/jobs?limit=50`)
      .set(bearer(recruiterA.token));
    const expectedIds = (all.body.items as Array<{ id: string }>).map(
      (job) => job.id,
    );
    expect(expectedIds.length).toBeGreaterThan(4);

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const url: string = `${API}/recruiter/jobs?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await http().get(url).set(bearer(recruiterA.token));
      expect(res.status).toBe(200);
      seen.push(
        ...(res.body.items as Array<{ id: string }>).map((job) => job.id),
      );
      cursor = res.body.nextCursor as string | null;
      if (!cursor) break;
    }
    expect(seen).toEqual(expectedIds);
  });

  it('rejects an invalid limit', async () => {
    const res = await http()
      .get(`${API}/recruiter/jobs?limit=0`)
      .set(bearer(recruiterA.token));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
