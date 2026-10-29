/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment --
   supertest response bodies are untyped (any) */
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { SKILLS } from '../src/modules/skills/skills.data';
import { createTestApp, signup, type TestApp } from './support/test-app';

const API = '/api/v1';
const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

const jobBody = {
  title: 'Développeur Node.js',
  description:
    'Rejoignez une équipe produit pour construire des API fiables et maintenables.',
  category: 'BACKEND',
  contractType: 'CDI',
  remotePolicy: 'HYBRID',
  experienceLevel: 'MID',
  city: 'Paris',
  skills: ['nodejs'],
};

let testApp: TestApp;
let app: INestApplication;
let recruiter: { token: string; id: string };
let candidate1: { token: string; id: string };
let candidate2: { token: string; id: string };
let candidate3: { token: string; id: string };
const jobs = { pub1: '', pub2: '', draft: '', closed: '' };

const http = () => request(app.getHttpServer() as Server);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createJob(title: string): Promise<string> {
  const res = await http()
    .post(`${API}/recruiter/jobs`)
    .set(bearer(recruiter.token))
    .send({ ...jobBody, title });
  return res.body.id as string;
}
const action = (id: string, name: 'publish' | 'close') =>
  http()
    .post(`${API}/recruiter/jobs/${id}/${name}`)
    .set(bearer(recruiter.token));

const saveJob = (token: string, id: string) =>
  http().put(`${API}/saved-jobs/${id}`).set(bearer(token));
const unsaveJob = (token: string, id: string) =>
  http().delete(`${API}/saved-jobs/${id}`).set(bearer(token));
const listSaved = (token: string, qs = '') =>
  http()
    .get(`${API}/saved-jobs${qs ? `?${qs}` : ''}`)
    .set(bearer(token));

const createSearch = (token: string, body: object) =>
  http().post(`${API}/saved-searches`).set(bearer(token)).send(body);
const listSearches = (token: string) =>
  http().get(`${API}/saved-searches`).set(bearer(token));
const patchSearch = (token: string, id: string, body: object) =>
  http().patch(`${API}/saved-searches/${id}`).set(bearer(token)).send(body);
const deleteSearch = (token: string, id: string) =>
  http().delete(`${API}/saved-searches/${id}`).set(bearer(token));

beforeAll(async () => {
  testApp = await createTestApp();
  app = testApp.app;
  await app.get(PrismaService).skill.createMany({ data: SKILLS });

  recruiter = await signup(app, 'recruiter@example.com', 'RECRUITER');
  candidate1 = await signup(app, 'candidate1@example.com', 'CANDIDATE');
  candidate2 = await signup(app, 'candidate2@example.com', 'CANDIDATE');
  candidate3 = await signup(app, 'candidate3@example.com', 'CANDIDATE');
  await http()
    .post(`${API}/companies`)
    .set(bearer(recruiter.token))
    .send({ name: 'Société Alpha' });

  jobs.pub1 = await createJob('Offre publiée 1');
  jobs.pub2 = await createJob('Offre publiée 2');
  jobs.draft = await createJob('Offre brouillon');
  jobs.closed = await createJob('Offre clôturée');
  for (const id of [jobs.pub1, jobs.pub2, jobs.closed])
    await action(id, 'publish');
  await action(jobs.closed, 'close');
});

afterAll(async () => {
  await testApp?.close();
});

describe('saved jobs: access', () => {
  it('requires authentication and the CANDIDATE role', async () => {
    expect((await http().put(`${API}/saved-jobs/${jobs.pub1}`)).status).toBe(
      401,
    );
    const res = await saveJob(recruiter.token, jobs.pub1);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AUTH_FORBIDDEN');
    expect((await http().get(`${API}/saved-jobs`)).status).toBe(401);
  });
});

describe('saved jobs', () => {
  it('saves a published job and is idempotent', async () => {
    const first = await saveJob(candidate1.token, jobs.pub1);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ jobId: jobs.pub1 });
    const second = await saveJob(candidate1.token, jobs.pub1);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
  });

  it('lets a candidate save a closed job', async () => {
    expect((await saveJob(candidate1.token, jobs.closed)).status).toBe(200);
  });

  it('refuses drafts and unknown jobs', async () => {
    const draft = await saveJob(candidate1.token, jobs.draft);
    expect(draft.status).toBe(404);
    expect(draft.body.code).toBe('JOB_NOT_FOUND');
    expect((await saveJob(candidate1.token, UNKNOWN_ID)).status).toBe(404);
  });

  it('lists saved jobs newest first with their open state', async () => {
    expect((await saveJob(candidate1.token, jobs.pub2)).status).toBe(200);
    const res = await listSaved(candidate1.token);
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{
      jobId: string;
      job: {
        title: string;
        status: string;
        isOpen: boolean;
        closedAt: string | null;
        company: { name: string };
      };
    }>;
    expect(items.map((item) => item.jobId)).toEqual([
      jobs.pub2,
      jobs.closed,
      jobs.pub1,
    ]);
    expect(items[0].job).toMatchObject({
      title: 'Offre publiée 2',
      status: 'PUBLISHED',
      isOpen: true,
    });
    expect(items[0].job.company.name).toBe('Société Alpha');
    expect(items[1].job).toMatchObject({ status: 'CLOSED', isOpen: false });
    expect(items[1].job.closedAt).not.toBeNull();
    expect(res.body.nextCursor).toBeNull();
  });

  it('paginates with a cursor', async () => {
    const first = await listSaved(candidate1.token, 'limit=2');
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await listSaved(
      candidate1.token,
      `limit=2&cursor=${first.body.nextCursor}`,
    );
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    const all = [...first.body.items, ...second.body.items].map(
      (item: { jobId: string }) => item.jobId,
    );
    expect(all).toEqual([jobs.pub2, jobs.closed, jobs.pub1]);
  });

  it('rejects an invalid limit', async () => {
    const res = await listSaved(candidate1.token, 'limit=0');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('keeps saved jobs private to their candidate', async () => {
    expect((await listSaved(candidate2.token)).body.items).toEqual([]);
  });

  it('shows a job closed after saving as not open', async () => {
    expect((await action(jobs.pub1, 'close')).status).toBe(200);
    const items = (await listSaved(candidate1.token)).body.items as Array<{
      jobId: string;
      job: { status: string; isOpen: boolean };
    }>;
    const saved = items.find((item) => item.jobId === jobs.pub1);
    expect(saved?.job).toMatchObject({ status: 'CLOSED', isOpen: false });
  });

  it('unsaves and is idempotent', async () => {
    expect((await unsaveJob(candidate1.token, jobs.pub1)).status).toBe(204);
    expect((await unsaveJob(candidate1.token, jobs.pub1)).status).toBe(204);
    const ids = (
      (await listSaved(candidate1.token)).body.items as Array<{ jobId: string }>
    ).map((item) => item.jobId);
    expect(ids).toEqual([jobs.pub2, jobs.closed]);
  });
});

describe('saved searches', () => {
  let searchId: string;

  it('requires authentication and the CANDIDATE role', async () => {
    expect((await http().post(`${API}/saved-searches`).send({})).status).toBe(
      401,
    );
    const res = await createSearch(recruiter.token, {
      name: 'x',
      filters: { q: 'node' },
    });
    expect(res.status).toBe(403);
  });

  it('creates a saved search with normalized filters and defaults', async () => {
    const res = await createSearch(candidate1.token, {
      name: 'Node backend',
      filters: {
        q: 'node.js',
        category: 'backend,fullstack',
        skills: 'NodeJS',
        empty: 'ignored',
      },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Node backend',
      frequency: 'DAILY',
      alertsEnabled: true,
    });
    expect(res.body.filters).toEqual({
      q: 'node.js',
      category: ['BACKEND', 'FULLSTACK'],
      skills: ['nodejs'],
    });
    searchId = res.body.id as string;
  });

  it('rejects invalid payloads', async () => {
    const empty = await createSearch(candidate1.token, {
      name: 'Empty',
      filters: {},
    });
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe('VALIDATION_ERROR');
    expect(
      (await createSearch(candidate1.token, { filters: { q: 'a' } })).status,
    ).toBe(400);
    expect(
      (
        await createSearch(candidate1.token, {
          name: 'x',
          filters: { category: 'cooking' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await createSearch(candidate1.token, {
          name: 'x',
          filters: { q: 'a' },
          frequency: 'HOURLY',
        })
      ).status,
    ).toBe(400);
  });

  it('lists only the own saved searches', async () => {
    const mine = await listSearches(candidate1.token);
    expect((mine.body as Array<{ id: string }>).map((s) => s.id)).toEqual([
      searchId,
    ]);
    expect((await listSearches(candidate2.token)).body).toEqual([]);
  });

  it('updates name, frequency, alerts flag and filters', async () => {
    const res = await patchSearch(candidate1.token, searchId, {
      name: 'Node instantané',
      frequency: 'INSTANT',
      alertsEnabled: false,
      filters: { city: 'Lyon' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Node instantané',
      frequency: 'INSTANT',
      alertsEnabled: false,
      filters: { city: 'Lyon' },
    });
  });

  it('requires a criterion when replacing the filters', async () => {
    const res = await patchSearch(candidate1.token, searchId, { filters: {} });
    expect(res.status).toBe(400);
  });

  it("hides another candidate's saved search behind a 404", async () => {
    for (const call of [
      patchSearch(candidate2.token, searchId, { name: 'Hijack' }),
      deleteSearch(candidate2.token, searchId),
    ]) {
      const res = await call;
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('SAVED_SEARCH_NOT_FOUND');
    }
  });

  it('deletes a saved search, then returns 404', async () => {
    expect((await deleteSearch(candidate1.token, searchId)).status).toBe(204);
    expect((await deleteSearch(candidate1.token, searchId)).status).toBe(404);
    expect((await listSearches(candidate1.token)).body).toEqual([]);
  });

  it('limits a candidate to 20 saved searches', async () => {
    for (let i = 0; i < 20; i += 1) {
      const res = await createSearch(candidate3.token, {
        name: `Search ${i}`,
        filters: { q: `term${i}` },
      });
      expect(res.status).toBe(201);
    }
    const res = await createSearch(candidate3.token, {
      name: 'One too many',
      filters: { q: 'extra' },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SAVED_SEARCH_LIMIT');
  });
});
