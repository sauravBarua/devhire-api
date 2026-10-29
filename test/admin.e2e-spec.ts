/* eslint-disable @typescript-eslint/no-unsafe-member-access --
   supertest response bodies are untyped (any) */
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Role } from '../src/generated/prisma/enums';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { SKILLS } from '../src/modules/skills/skills.data';
import {
  createTestApp,
  signup,
  TEST_PASSWORD,
  type TestApp,
} from './support/test-app';

const API = '/api/v1';
const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';
const REASON = 'Offre non conforme aux règles de la plateforme.';

const jobBody = {
  title: 'Développeur Zebra',
  description:
    'Rejoignez une équipe produit pour construire des API fiables et maintenables.',
  category: 'BACKEND',
  contractType: 'CDI',
  remotePolicy: 'HYBRID',
  experienceLevel: 'MID',
  city: 'Paris',
  skills: [],
};

const events: Array<{ name: string; id: string }> = [];

let testApp: TestApp;
let app: INestApplication;
let admin: { token: string };
let recruiterA: { token: string; id: string };
let recruiterB: { token: string; id: string };
let candidate: { token: string; id: string };
let companyA: { id: string; slug: string };
let companyB: { id: string; slug: string };
const jobs = { a1: '', a2: '', aDraft: '', b1: '' };

const http = () => request(app.getHttpServer() as Server);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createJob(
  token: string,
  overrides: object = {},
): Promise<string> {
  const res = await http()
    .post(`${API}/recruiter/jobs`)
    .set(bearer(token))
    .send({ ...jobBody, ...overrides });
  expect(res.status).toBe(201);
  return res.body.id as string;
}
const recruiterAction = (
  token: string,
  id: string,
  name: 'publish' | 'close' | 'renew',
) => http().post(`${API}/recruiter/jobs/${id}/${name}`).set(bearer(token));
const adminGet = (path: string) =>
  http().get(`${API}/admin/${path}`).set(bearer(admin.token));
const adminPost = (path: string, body?: object) =>
  http().post(`${API}/admin/${path}`).set(bearer(admin.token)).send(body);
const search = (qs = '') => http().get(`${API}/jobs${qs ? `?${qs}` : ''}`);
const idsOf = (res: { body: { items: Array<{ id: string }> } }): string[] =>
  res.body.items.map((item) => item.id);

beforeAll(async () => {
  testApp = await createTestApp();
  app = testApp.app;
  const prisma = app.get(PrismaService);
  await prisma.skill.createMany({ data: SKILLS });

  await prisma.user.create({
    data: {
      email: 'admin@example.com',
      passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
      firstName: 'Ada',
      lastName: 'Admin',
      role: Role.ADMIN,
    },
  });
  const login = await http()
    .post(`${API}/auth/login`)
    .send({ email: 'admin@example.com', password: TEST_PASSWORD });
  admin = { token: login.body.accessToken as string };

  recruiterA = await signup(app, 'recruiter.a@example.com', 'RECRUITER');
  recruiterB = await signup(app, 'recruiter.b@example.com', 'RECRUITER');
  candidate = await signup(app, 'candidate@example.com', 'CANDIDATE');

  const a = await http()
    .post(`${API}/companies`)
    .set(bearer(recruiterA.token))
    .send({ name: 'Alpha Studio' });
  const b = await http()
    .post(`${API}/companies`)
    .set(bearer(recruiterB.token))
    .send({ name: 'Beta Labs' });
  companyA = { id: a.body.id as string, slug: a.body.slug as string };
  companyB = { id: b.body.id as string, slug: b.body.slug as string };

  jobs.a1 = await createJob(recruiterA.token, {
    title: 'Développeur Zebra A1',
  });
  jobs.a2 = await createJob(recruiterA.token, {
    title: 'Développeur Zebra A2',
  });
  jobs.aDraft = await createJob(recruiterA.token, { title: 'Brouillon Zebra' });
  jobs.b1 = await createJob(recruiterB.token, {
    title: 'Développeur Zebra B1',
  });
  for (const [token, id] of [
    [recruiterA.token, jobs.a1],
    [recruiterA.token, jobs.a2],
    [recruiterB.token, jobs.b1],
  ] as const) {
    expect((await recruiterAction(token, id, 'publish')).status).toBe(200);
  }

  const emitter = app.get(EventEmitter2);
  emitter.on('job.closed', (payload: { jobId: string }) =>
    events.push({ name: 'job.closed', id: payload.jobId }),
  );
  emitter.on('company.hidden', (payload: { companyId: string }) =>
    events.push({ name: 'company.hidden', id: payload.companyId }),
  );
  emitter.on('company.restored', (payload: { companyId: string }) =>
    events.push({ name: 'company.restored', id: payload.companyId }),
  );
});

afterAll(async () => {
  await testApp?.close();
});

describe('access', () => {
  it('requires authentication', async () => {
    expect((await http().get(`${API}/admin/jobs`)).status).toBe(401);
  });

  it('forbids candidates and recruiters on every admin route', async () => {
    for (const token of [candidate.token, recruiterA.token]) {
      for (const call of [
        http().get(`${API}/admin/jobs`).set(bearer(token)),
        http().get(`${API}/admin/companies`).set(bearer(token)),
        http()
          .post(`${API}/admin/jobs/${jobs.a1}/close`)
          .set(bearer(token))
          .send({ reason: REASON }),
        http()
          .post(`${API}/admin/companies/${companyA.id}/hide`)
          .set(bearer(token))
          .send({ reason: REASON }),
        http()
          .post(`${API}/admin/skills`)
          .set(bearer(token))
          .send({ slug: 'x', name: 'X' }),
      ]) {
        const res = await call;
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('AUTH_FORBIDDEN');
      }
    }
  });
});

describe('admin job list', () => {
  it('lists non-draft jobs with their company', async () => {
    const res = await adminGet('jobs?limit=50');
    expect(res.status).toBe(200);
    expect(idsOf(res).sort()).toEqual([jobs.a1, jobs.a2, jobs.b1].sort());
    const item = (
      res.body.items as Array<{
        id: string;
        company: { name: string; isHidden: boolean };
      }>
    ).find((entry) => entry.id === jobs.b1);
    expect(item?.company).toMatchObject({ name: 'Beta Labs', isHidden: false });
  });

  it('filters by status and company, and shows drafts only when asked', async () => {
    expect(idsOf(await adminGet('jobs?status=DRAFT'))).toEqual([jobs.aDraft]);
    expect(idsOf(await adminGet(`jobs?companyId=${companyB.id}`))).toEqual([
      jobs.b1,
    ]);
    expect(idsOf(await adminGet('jobs?status=CLOSED'))).toEqual([]);
  });

  it('paginates with a cursor', async () => {
    const first = await adminGet('jobs?limit=2');
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await adminGet(
      `jobs?limit=2&cursor=${first.body.nextCursor}`,
    );
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
  });

  it('rejects an invalid status', async () => {
    const res = await adminGet('jobs?status=MAYBE');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('force-close a job', () => {
  it('requires a reason', async () => {
    for (const body of [{}, { reason: '  ' }, { reason: 'ab' }]) {
      const res = await adminPost(`jobs/${jobs.a1}/close`, body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns 404 for an unknown job and 409 for a draft', async () => {
    const unknown = await adminPost(`jobs/${UNKNOWN_ID}/close`, {
      reason: REASON,
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('JOB_NOT_FOUND');
    const draft = await adminPost(`jobs/${jobs.aDraft}/close`, {
      reason: REASON,
    });
    expect(draft.status).toBe(409);
    expect(draft.body.code).toBe('JOB_INVALID_TRANSITION');
  });

  it('closes a published job, records the moderation and clears it from search at once', async () => {
    const before = await search('q=zebra&limit=50');
    expect(idsOf(before)).toContain(jobs.a1);

    const res = await adminPost(`jobs/${jobs.a1}/close`, { reason: REASON });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: jobs.a1,
      status: 'CLOSED',
      moderationReason: REASON,
    });
    expect(res.body.moderatedAt).not.toBeNull();
    expect(res.body.closedAt).not.toBeNull();
    expect(res.body.company.name).toBe('Alpha Studio');
    expect(
      events.filter((e) => e.name === 'job.closed' && e.id === jobs.a1),
    ).toHaveLength(1);

    // same query as above: the cached result must have been invalidated
    const after = await search('q=zebra&limit=50');
    expect(idsOf(after)).not.toContain(jobs.a1);
    expect(idsOf(after)).toContain(jobs.a2);
  });

  it('refuses to close it twice', async () => {
    const res = await adminPost(`jobs/${jobs.a1}/close`, { reason: REASON });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('JOB_INVALID_TRANSITION');
  });

  it('keeps the job viewable as closed, without leaking the reason publicly', async () => {
    const res = await http().get(`${API}/jobs/${jobs.a1}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'CLOSED', isOpen: false });
    expect(res.body.moderationReason).toBeUndefined();
    expect(res.body.moderatedAt).toBeUndefined();
  });

  it('shows the owner the reason but refuses to let them renew the job', async () => {
    const view = await http()
      .get(`${API}/recruiter/jobs/${jobs.a1}`)
      .set(bearer(recruiterA.token));
    expect(view.body).toMatchObject({
      status: 'CLOSED',
      moderationReason: REASON,
    });

    const renew = await recruiterAction(recruiterA.token, jobs.a1, 'renew');
    expect(renew.status).toBe(409);
    expect(renew.body.code).toBe('JOB_MODERATED');
  });

  it('still lets a recruiter renew a job they closed themselves', async () => {
    expect(
      (await recruiterAction(recruiterA.token, jobs.a2, 'close')).status,
    ).toBe(200);
    expect(
      (await recruiterAction(recruiterA.token, jobs.a2, 'renew')).status,
    ).toBe(200);
  });
});

describe('hide and restore a company', () => {
  it('lists companies and filters them', async () => {
    const all = await adminGet('companies');
    expect(
      (all.body.items as Array<{ name: string }>).map((c) => c.name).sort(),
    ).toEqual(['Alpha Studio', 'Beta Labs']);
    expect(idsOf(await adminGet('companies?hidden=true'))).toEqual([]);
    expect(idsOf(await adminGet('companies?hidden=false'))).toHaveLength(2);
    expect(idsOf(await adminGet('companies?q=beta'))).toEqual([companyB.id]);
  });

  it('requires a reason and an existing company', async () => {
    expect((await adminPost(`companies/${companyB.id}/hide`, {})).status).toBe(
      400,
    );
    const unknown = await adminPost(`companies/${UNKNOWN_ID}/hide`, {
      reason: REASON,
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('COMPANY_NOT_FOUND');
    expect((await adminPost(`companies/${UNKNOWN_ID}/restore`)).status).toBe(
      404,
    );
  });

  it('hides a company: page, jobs, search and applications disappear', async () => {
    const before = await search('limit=50');
    expect(idsOf(before)).toContain(jobs.b1);
    const totalBefore = before.body.total as number;
    expect((await http().get(`${API}/companies/${companyB.slug}`)).status).toBe(
      200,
    );

    const res = await adminPost(`companies/${companyB.id}/hide`, {
      reason: REASON,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: companyB.id,
      isHidden: true,
      hiddenReason: REASON,
    });
    expect(res.body.hiddenAt).not.toBeNull();
    expect(
      events.filter((e) => e.name === 'company.hidden' && e.id === companyB.id),
    ).toHaveLength(1);

    const page = await http().get(`${API}/companies/${companyB.slug}`);
    expect(page.status).toBe(404);
    expect(page.body.code).toBe('COMPANY_NOT_FOUND');

    const detail = await http().get(`${API}/jobs/${jobs.b1}`);
    expect(detail.status).toBe(404);
    expect(detail.body.code).toBe('JOB_NOT_FOUND');

    // same query as before: the cached result must have been invalidated
    const after = await search('limit=50');
    expect(idsOf(after)).not.toContain(jobs.b1);
    expect(after.body.total).toBe(totalBefore - 1);
    expect(idsOf(await search('q=zebra&limit=50'))).not.toContain(jobs.b1);

    const apply = await http()
      .post(`${API}/jobs/${jobs.b1}/applications`)
      .set(bearer(candidate.token))
      .attach('cv', Buffer.from('%PDF-1.7\nhello'), {
        filename: 'cv.pdf',
        contentType: 'application/pdf',
      });
    expect(apply.status).toBe(404);
  });

  it('tells the owner and stops them from publishing or renewing', async () => {
    const own = await http()
      .get(`${API}/companies/me`)
      .set(bearer(recruiterB.token));
    expect(own.status).toBe(200);
    expect(own.body.isHidden).toBe(true);

    const draft = await createJob(recruiterB.token, {
      title: 'Nouveau brouillon',
    });
    const publish = await recruiterAction(recruiterB.token, draft, 'publish');
    expect(publish.status).toBe(403);
    expect(publish.body.code).toBe('COMPANY_HIDDEN');

    expect(
      (await recruiterAction(recruiterB.token, jobs.b1, 'close')).status,
    ).toBe(200);
    const renew = await recruiterAction(recruiterB.token, jobs.b1, 'renew');
    expect(renew.status).toBe(403);
    expect(renew.body.code).toBe('COMPANY_HIDDEN');
  });

  it('shows hidden companies in the admin list, and refuses to hide twice', async () => {
    const hidden = await adminGet('companies?hidden=true');
    expect(idsOf(hidden)).toEqual([companyB.id]);
    expect(hidden.body.items[0].hiddenReason).toBe(REASON);

    const again = await adminPost(`companies/${companyB.id}/hide`, {
      reason: REASON,
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('COMPANY_ALREADY_HIDDEN');
  });

  it('restores a company: page and search come back, publishing works again', async () => {
    const res = await adminPost(`companies/${companyB.id}/restore`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      isHidden: false,
      hiddenAt: null,
      hiddenReason: null,
    });
    expect(
      events.filter(
        (e) => e.name === 'company.restored' && e.id === companyB.id,
      ),
    ).toHaveLength(1);

    expect((await http().get(`${API}/companies/${companyB.slug}`)).status).toBe(
      200,
    );
    const detail = await http().get(`${API}/jobs/${jobs.b1}`);
    expect(detail.status).toBe(200);

    expect(
      (await recruiterAction(recruiterB.token, jobs.b1, 'renew')).status,
    ).toBe(200);
    expect(idsOf(await search('q=zebra&limit=50'))).toContain(jobs.b1);

    const again = await adminPost(`companies/${companyB.id}/restore`);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('COMPANY_NOT_HIDDEN');
  });
});

describe('skills management', () => {
  let zigzagId: string;

  it('creates a skill with normalized aliases and lists it publicly', async () => {
    const res = await adminPost('skills', {
      slug: 'zigzag',
      name: 'Zigzag',
      aliases: [' ZZ-Alias ', 'zz-alias', 'zzother'],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      slug: 'zigzag',
      name: 'Zigzag',
      aliases: ['zz-alias', 'zzother'],
    });
    zigzagId = res.body.id as string;

    const list = await http().get(`${API}/skills`);
    expect((list.body as Array<{ slug: string }>).map((s) => s.slug)).toContain(
      'zigzag',
    );
  });

  it('rejects clashing and malformed skills', async () => {
    const slug = await adminPost('skills', { slug: 'zigzag', name: 'Another' });
    expect(slug.status).toBe(409);
    expect(slug.body.code).toBe('SKILL_CONFLICT');

    const alias = await adminPost('skills', {
      slug: 'node-two',
      name: 'Node Two',
      aliases: ['node'],
    });
    expect(alias.status).toBe(409);
    expect(alias.body.details).toEqual({ term: 'node', with: 'nodejs' });

    const name = await adminPost('skills', {
      slug: 'node-three',
      name: 'Node.js',
    });
    expect(name.status).toBe(409);
    expect(name.body.details.with).toBe('nodejs');

    for (const body of [
      { slug: 'Bad Slug', name: 'x' },
      { slug: 'ok', name: '' },
      { name: 'no slug' },
    ]) {
      const res = await adminPost('skills', body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
  });

  it('refuses an update that would steal another skill term, and 404s unknown ids', async () => {
    const steal = await http()
      .patch(`${API}/admin/skills/${zigzagId}`)
      .set(bearer(admin.token))
      .send({ aliases: ['react'] });
    expect(steal.status).toBe(409);
    expect(steal.body.code).toBe('SKILL_CONFLICT');

    const unknown = await http()
      .patch(`${API}/admin/skills/${UNKNOWN_ID}`)
      .set(bearer(admin.token))
      .send({ name: 'Nope' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('SKILL_NOT_FOUND');
  });

  it('refreshes the search index of jobs that use a skill when its aliases change', async () => {
    const jobId = await createJob(recruiterA.token, {
      title: 'Offre skill',
      skills: ['zigzag'],
    });
    expect(
      (await recruiterAction(recruiterA.token, jobId, 'publish')).status,
    ).toBe(200);

    const res = await http()
      .patch(`${API}/admin/skills/${zigzagId}`)
      .set(bearer(admin.token))
      .send({ name: 'Zigzag Pro', aliases: ['zzfresh'] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      slug: 'zigzag',
      name: 'Zigzag Pro',
      aliases: ['zzfresh'],
    });

    expect(idsOf(await search('q=zzfresh'))).toEqual([jobId]);
    expect(idsOf(await search('q=zzother'))).toEqual([]);
  });

  it('refuses to delete a skill that jobs use, deletes an unused one, then 404s', async () => {
    const used = await http()
      .delete(`${API}/admin/skills/${zigzagId}`)
      .set(bearer(admin.token));
    expect(used.status).toBe(409);
    expect(used.body.code).toBe('SKILL_IN_USE');
    expect(used.body.details).toEqual({ jobs: 1 });

    const temp = await adminPost('skills', {
      slug: 'temp-skill',
      name: 'Temp Skill',
    });
    const del = await http()
      .delete(`${API}/admin/skills/${temp.body.id}`)
      .set(bearer(admin.token));
    expect(del.status).toBe(204);
    const again = await http()
      .delete(`${API}/admin/skills/${temp.body.id}`)
      .set(bearer(admin.token));
    expect(again.status).toBe(404);
  });
});
