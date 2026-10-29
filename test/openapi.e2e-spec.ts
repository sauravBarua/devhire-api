import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Role } from '../src/generated/prisma/enums';
import { CloudinaryService } from '../src/infra/cloudinary/cloudinary.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { SKILLS } from '../src/modules/skills/skills.data';
import {
  adminCompanyPageSchema,
  adminCompanySchema,
  adminJobPageSchema,
  adminJobSchema,
  applicationSchema,
  authSchema,
  candidateApplicationPageSchema,
  companySchema,
  errorSchema,
  healthLiveSchema,
  healthReadySchema,
  jobPageSchema,
  jobSchema,
  publicJobSchema,
  recruiterApplicationPageSchema,
  recruiterApplicationSchema,
  savedJobPageSchema,
  savedJobSchema,
  savedSearchSchema,
  searchResultSchema,
  skillSchema,
  userSchema,
} from '../src/openapi/schemas';
import { createTestApp, TEST_PASSWORD, type TestApp } from './support/test-app';

type OperationObject = NonNullable<OpenAPIObject['paths'][string]['get']>;

const API = '/api/v1';
const EXPECTED_OPERATIONS = 42; // update together with src/openapi/operations.ts when an endpoint is added

const fakeCloudinary = {
  uploadPdf: (buffer: Buffer) =>
    Promise.resolve({
      publicId: 'devhire/cvs/test.pdf',
      secureUrl: 'https://res.example.test/cv.pdf',
      size: buffer.length,
      mime: 'application/pdf',
    }),
  uploadImage: () => Promise.reject(new Error('not used in this suite')),
  destroy: () => Promise.resolve(),
};
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 'a')]);

const PUBLIC_OPERATIONS = new Set([
  'post /auth/register',
  'post /auth/login',
  'post /auth/refresh',
  'post /auth/logout',
  'get /skills',
  'get /jobs',
  'get /jobs/{id}',
  'get /companies/{slug}',
  'get /health/live',
  'get /health/ready',
]);

let testApp: TestApp;
let app: INestApplication;
let doc: OpenAPIObject;

const http = () => request(app.getHttpServer() as Server);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// prints the response body when a status is not the expected one
function expectStatus(
  res: { status: number; body: unknown },
  status: number,
): void {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
}

function operationsOf(
  document: OpenAPIObject,
): Array<{ key: string; op: OperationObject }> {
  const result: Array<{ key: string; op: OperationObject }> = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const op = item[method];
      if (op) result.push({ key: `${method} ${path}`, op });
    }
  }
  return result;
}

beforeAll(async () => {
  testApp = await createTestApp(
    [{ provide: CloudinaryService, useValue: fakeCloudinary }],
    {
      DOCS_ENABLED: 'true',
    },
  );
  app = testApp.app;
  await app.get(PrismaService).skill.createMany({ data: SKILLS });
  const res = await http().get('/docs-json');
  expectStatus(res, 200);
  doc = res.body as OpenAPIObject;
});

afterAll(async () => {
  await testApp?.close();
});

describe('OpenAPI document', () => {
  it('is served at /docs-json, with the UI at /docs, outside the /api/v1 prefix', async () => {
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.info.title).toBe('DevHire API');
    expect([200, 301, 302]).toContain((await http().get('/docs')).status);
  });

  it('uses /api/v1 as the server and unprefixed paths', () => {
    expect(doc.servers).toEqual([{ url: '/api/v1' }]);
    expect(
      Object.keys(doc.paths).every((path) => !path.startsWith('/api')),
    ).toBe(true);
  });

  it('declares the bearer scheme', () => {
    expect(doc.components?.securitySchemes?.bearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('documents every operation: one tag, one success response, a default error', () => {
    const operations = operationsOf(doc);
    expect(operations).toHaveLength(EXPECTED_OPERATIONS);
    for (const { key, op } of operations) {
      expect(op.operationId, key).toBeTruthy();
      expect(op.tags, key).toHaveLength(1);
      expect(op.responses.default, key).toBeDefined();
      expect(
        Object.keys(op.responses).filter((code) => /^2\d\d$/.test(code)),
        key,
      ).toHaveLength(1);
    }
  });

  it('marks public routes as open and every other route as bearer-protected', () => {
    for (const { key, op } of operationsOf(doc)) {
      expect(op.security, key).toEqual(
        PUBLIC_OPERATIONS.has(key) ? [] : [{ bearer: [] }],
      );
    }
    expect(doc.paths['/admin/jobs'].get?.description).toBe(
      'Requires role: ADMIN.',
    );
  });

  it('resolves every $ref', () => {
    const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(refs.length).toBeGreaterThan(40);
    for (const ref of refs) {
      expect(ref.startsWith('#/components/schemas/'), ref).toBe(true);
      expect(
        doc.components?.schemas?.[ref.replace('#/components/schemas/', '')],
        ref,
      ).toBeDefined();
    }
  });

  it('documents JSON request bodies and query parameters from the Zod DTOs', () => {
    expect(doc.paths['/auth/login'].post?.requestBody).toBeDefined();
    expect(doc.paths['/recruiter/jobs'].post?.requestBody).toBeDefined();
    const names = (doc.paths['/jobs'].get?.parameters ?? []).map((p) =>
      'name' in p ? p.name : '',
    );
    expect(names).toEqual(
      expect.arrayContaining(['q', 'category', 'skills', 'limit', 'cursor']),
    );
  });

  it('documents the multipart uploads and the refresh cookie', () => {
    const logo = doc.paths['/companies/me/logo'].post?.requestBody;
    const cv = doc.paths['/jobs/{jobId}/applications'].post?.requestBody;
    expect(JSON.stringify(logo)).toContain('multipart/form-data');
    expect(JSON.stringify(cv)).toContain('"cv"');
    expect(
      JSON.stringify(doc.paths['/auth/refresh'].post?.parameters),
    ).toContain('refresh_token');
  });
});

// Each real response must parse against the strict schema published in the document.
describe('response contracts', () => {
  let recruiter: { token: string; id: string };
  let candidate: { token: string; id: string };
  let adminToken: string;
  let companyId: string;
  let jobId: string;
  let applicationId: string;

  async function register(email: string, role: 'CANDIDATE' | 'RECRUITER') {
    const res = await http().post(`${API}/auth/register`).send({
      email,
      password: TEST_PASSWORD,
      firstName: 'Test',
      lastName: 'User',
      role,
    });
    expectStatus(res, 201);
    const body = authSchema.parse(res.body);
    return { token: body.accessToken, id: body.user.id };
  }

  it('auth: register, login and me', async () => {
    recruiter = await register('recruiter@example.com', 'RECRUITER');
    candidate = await register('candidate@example.com', 'CANDIDATE');

    const login = await http()
      .post(`${API}/auth/login`)
      .send({ email: 'candidate@example.com', password: TEST_PASSWORD });
    expectStatus(login, 200);
    authSchema.parse(login.body);

    const me = await http().get(`${API}/auth/me`).set(bearer(candidate.token));
    expectStatus(me, 200);
    userSchema.parse(me.body);

    await app.get(PrismaService).user.create({
      data: {
        email: 'admin@example.com',
        passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
        firstName: 'Ada',
        lastName: 'Admin',
        role: Role.ADMIN,
      },
    });
    const admin = await http()
      .post(`${API}/auth/login`)
      .send({ email: 'admin@example.com', password: TEST_PASSWORD });
    expectStatus(admin, 200);
    adminToken = authSchema.parse(admin.body).accessToken;
  });

  it('companies and skills', async () => {
    const created = await http()
      .post(`${API}/companies`)
      .set(bearer(recruiter.token))
      .send({
        name: 'Contrat Studio',
        city: 'Paris',
        website: 'https://contrat.example.com',
      });
    expectStatus(created, 201);
    const company = companySchema.parse(created.body);
    companyId = company.id;

    for (const res of [
      await http().get(`${API}/companies/me`).set(bearer(recruiter.token)),
      await http()
        .patch(`${API}/companies/me`)
        .set(bearer(recruiter.token))
        .send({ city: 'Lyon' }),
      await http().get(`${API}/companies/${company.slug}`),
    ]) {
      expectStatus(res, 200);
      companySchema.parse(res.body);
    }

    const skills = await http().get(`${API}/skills`);
    expectStatus(skills, 200);
    expect(z.array(skillSchema).parse(skills.body).length).toBeGreaterThan(20);
  });

  it('recruiter jobs: create, list, get, update, publish, close, renew, delete a draft', async () => {
    const body = {
      title: 'Développeur Node.js contrat',
      description:
        'Rejoignez une équipe produit pour construire des API fiables et maintenables.',
      category: 'BACKEND',
      contractType: 'CDI',
      remotePolicy: 'HYBRID',
      experienceLevel: 'MID',
      city: 'Paris',
      salaryMin: 45000,
      salaryMax: 60000,
      skills: ['nodejs', 'typescript'],
    };
    const created = await http()
      .post(`${API}/recruiter/jobs`)
      .set(bearer(recruiter.token))
      .send(body);
    expectStatus(created, 201);
    jobId = jobSchema.parse(created.body).id;

    const list = await http()
      .get(`${API}/recruiter/jobs`)
      .set(bearer(recruiter.token));
    expectStatus(list, 200);
    expect(jobPageSchema.parse(list.body).items.length).toBeGreaterThan(0);

    const get = await http()
      .get(`${API}/recruiter/jobs/${jobId}`)
      .set(bearer(recruiter.token));
    expectStatus(get, 200);
    jobSchema.parse(get.body);

    const update = await http()
      .patch(`${API}/recruiter/jobs/${jobId}`)
      .set(bearer(recruiter.token))
      .send({ city: null });
    expectStatus(update, 200);
    jobSchema.parse(update.body);

    for (const action of ['publish', 'close', 'renew']) {
      const res = await http()
        .post(`${API}/recruiter/jobs/${jobId}/${action}`)
        .set(bearer(recruiter.token));
      expectStatus(res, 200);
      jobSchema.parse(res.body);
    }

    const draft = await http()
      .post(`${API}/recruiter/jobs`)
      .set(bearer(recruiter.token))
      .send(body);
    const del = await http()
      .delete(`${API}/recruiter/jobs/${jobSchema.parse(draft.body).id}`)
      .set(bearer(recruiter.token));
    expectStatus(del, 204);
    expect(del.text).toBe('');
  });

  it('public job detail and search', async () => {
    const detail = await http().get(`${API}/jobs/${jobId}`);
    expectStatus(detail, 200);
    publicJobSchema.parse(detail.body);

    const search = await http().get(`${API}/jobs?limit=5`);
    expectStatus(search, 200);
    const result = searchResultSchema.parse(search.body);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.total).toBeGreaterThan(0);
    expect(result.facets).not.toBeNull();
  });

  it('applications', async () => {
    const applied = await http()
      .post(`${API}/jobs/${jobId}/applications`)
      .set(bearer(candidate.token))
      .field('coverLetter', 'Bonjour')
      .attach('cv', pdf, {
        filename: 'cv.pdf',
        contentType: 'application/pdf',
      });
    expectStatus(applied, 201);
    applicationId = applicationSchema.parse(applied.body).id;

    const mine = await http()
      .get(`${API}/applications/me`)
      .set(bearer(candidate.token));
    expectStatus(mine, 200);
    expect(candidateApplicationPageSchema.parse(mine.body).items).toHaveLength(
      1,
    );

    const forJob = await http()
      .get(`${API}/recruiter/jobs/${jobId}/applications`)
      .set(bearer(recruiter.token));
    expectStatus(forJob, 200);
    expect(
      recruiterApplicationPageSchema.parse(forJob.body).items,
    ).toHaveLength(1);

    const status = await http()
      .patch(`${API}/recruiter/applications/${applicationId}/status`)
      .set(bearer(recruiter.token))
      .send({ status: 'REVIEWED' });
    expectStatus(status, 200);
    recruiterApplicationSchema.parse(status.body);
  });

  it('saved jobs and saved searches', async () => {
    const save = await http()
      .put(`${API}/saved-jobs/${jobId}`)
      .set(bearer(candidate.token));
    expectStatus(save, 200);
    savedJobSchema.parse(save.body);

    const list = await http()
      .get(`${API}/saved-jobs`)
      .set(bearer(candidate.token));
    expectStatus(list, 200);
    expect(savedJobPageSchema.parse(list.body).items).toHaveLength(1);
    expectStatus(
      await http()
        .delete(`${API}/saved-jobs/${jobId}`)
        .set(bearer(candidate.token)),
      204,
    );

    const created = await http()
      .post(`${API}/saved-searches`)
      .set(bearer(candidate.token))
      .send({
        name: 'Node',
        filters: { q: 'node.js', category: 'backend' },
        frequency: 'INSTANT',
      });
    expectStatus(created, 201);
    const searchId = savedSearchSchema.parse(created.body).id;

    const searches = await http()
      .get(`${API}/saved-searches`)
      .set(bearer(candidate.token));
    expectStatus(searches, 200);
    expect(z.array(savedSearchSchema).parse(searches.body)).toHaveLength(1);

    const patched = await http()
      .patch(`${API}/saved-searches/${searchId}`)
      .set(bearer(candidate.token))
      .send({ alertsEnabled: false });
    expectStatus(patched, 200);
    savedSearchSchema.parse(patched.body);
    expectStatus(
      await http()
        .delete(`${API}/saved-searches/${searchId}`)
        .set(bearer(candidate.token)),
      204,
    );
  });

  it('admin: moderation and skills', async () => {
    const jobs = await http().get(`${API}/admin/jobs`).set(bearer(adminToken));
    expectStatus(jobs, 200);
    expect(adminJobPageSchema.parse(jobs.body).items.length).toBeGreaterThan(0);

    const companies = await http()
      .get(`${API}/admin/companies`)
      .set(bearer(adminToken));
    expectStatus(companies, 200);
    expect(adminCompanyPageSchema.parse(companies.body).items).toHaveLength(1);

    const reason = { reason: 'Vérification en cours.' };
    const hide = await http()
      .post(`${API}/admin/companies/${companyId}/hide`)
      .set(bearer(adminToken))
      .send(reason);
    expectStatus(hide, 200);
    adminCompanySchema.parse(hide.body);
    const restore = await http()
      .post(`${API}/admin/companies/${companyId}/restore`)
      .set(bearer(adminToken));
    expectStatus(restore, 200);
    adminCompanySchema.parse(restore.body);

    const close = await http()
      .post(`${API}/admin/jobs/${jobId}/close`)
      .set(bearer(adminToken))
      .send(reason);
    expectStatus(close, 200);
    adminJobSchema.parse(close.body);

    const created = await http()
      .post(`${API}/admin/skills`)
      .set(bearer(adminToken))
      .send({
        slug: 'contract-skill',
        name: 'Contract Skill',
        aliases: ['cs-alias'],
      });
    expectStatus(created, 201);
    const skillId = skillSchema.parse(created.body).id;
    const updated = await http()
      .patch(`${API}/admin/skills/${skillId}`)
      .set(bearer(adminToken))
      .send({ name: 'Contract Skill Pro' });
    expectStatus(updated, 200);
    skillSchema.parse(updated.body);
    expectStatus(
      await http()
        .delete(`${API}/admin/skills/${skillId}`)
        .set(bearer(adminToken)),
      204,
    );
  });

  it('health', async () => {
    const live = await http().get(`${API}/health/live`);
    expectStatus(live, 200);
    healthLiveSchema.parse(live.body);
    const ready = await http().get(`${API}/health/ready`);
    expectStatus(ready, 200);
    healthReadySchema.parse(ready.body);
  });

  it('errors use the documented shape', async () => {
    const notFound = await http().get(
      `${API}/jobs/00000000-0000-0000-0000-000000000000`,
    );
    expectStatus(notFound, 404);
    expect(errorSchema.parse(notFound.body).code).toBe('JOB_NOT_FOUND');

    const invalid = await http()
      .post(`${API}/auth/login`)
      .send({ email: 'not-an-email' });
    expectStatus(invalid, 400);
    const error = errorSchema.parse(invalid.body);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(error.details)).toBe(true);
  });
});
