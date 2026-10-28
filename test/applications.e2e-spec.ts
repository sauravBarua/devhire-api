/* eslint-disable @typescript-eslint/no-unsafe-member-access --
   supertest response bodies are untyped (any) */
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CloudinaryService } from '../src/infra/cloudinary/cloudinary.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { createTestApp, signup, type TestApp } from './support/test-app';

const API = '/api/v1';
const DAY_MS = 24 * 60 * 60 * 1000;

let uploads = 0;
const destroyed: Array<{ publicId: string; resourceType: string | undefined }> =
  [];
const fakeCloudinary = {
  uploadPdf: (buffer: Buffer) => {
    uploads += 1;
    return Promise.resolve({
      publicId: `devhire/cvs/test-${uploads}.pdf`,
      secureUrl: `https://res.example.test/cv-${uploads}.pdf`,
      size: buffer.length,
      mime: 'application/pdf',
    });
  },
  uploadImage: () => Promise.reject(new Error('not used in this suite')),
  destroy: (publicId: string, resourceType?: string) => {
    destroyed.push({ publicId, resourceType });
    return Promise.resolve();
  },
};

const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(256, 'a')]);

const jobBody = {
  title: 'Développeur Node.js',
  description:
    'Rejoignez une équipe produit pour construire des API fiables et maintenables.',
  category: 'BACKEND',
  contractType: 'CDI',
  remotePolicy: 'HYBRID',
  experienceLevel: 'MID',
  city: 'Paris',
  skills: [],
};

interface CreatedEvent {
  applicationId: string;
  jobId: string;
  candidateId: string;
  companyId: string;
}
interface StatusEvent {
  applicationId: string;
  from: string;
  to: string;
}
const createdEvents: CreatedEvent[] = [];
const statusEvents: StatusEvent[] = [];

let testApp: TestApp;
let app: INestApplication;
let recruiterA: { token: string; id: string };
let recruiterB: { token: string; id: string };
let recruiterNoCompany: { token: string; id: string };
let candidate1: { token: string; id: string };
let candidate2: { token: string; id: string };
let candidate3: { token: string; id: string };
const jobs: Record<'open' | 'open2' | 'draft' | 'closed' | 'expired', string> =
  {
    open: '',
    open2: '',
    draft: '',
    closed: '',
    expired: '',
  };
let app1: string;
let app2: string;

const http = () => request(app.getHttpServer() as Server);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createJob(token: string, title: string): Promise<string> {
  const res = await http()
    .post(`${API}/recruiter/jobs`)
    .set(bearer(token))
    .send({ ...jobBody, title });
  return res.body.id as string;
}
const post = (token: string, id: string, action: 'publish' | 'close') =>
  http().post(`${API}/recruiter/jobs/${id}/${action}`).set(bearer(token));

interface ApplyOptions {
  file?: Buffer | null;
  contentType?: string;
  coverLetter?: string;
}
function apply(token: string, jobId: string, options: ApplyOptions = {}) {
  const { file = pdf, contentType = 'application/pdf', coverLetter } = options;
  let req = http().post(`${API}/jobs/${jobId}/applications`).set(bearer(token));
  if (coverLetter !== undefined) req = req.field('coverLetter', coverLetter);
  if (file !== null)
    req = req.attach('cv', file, { filename: 'cv.pdf', contentType });
  return req;
}

const mine = (token: string, qs = '') =>
  http()
    .get(`${API}/applications/me${qs ? `?${qs}` : ''}`)
    .set(bearer(token));
const forJob = (token: string, jobId: string, qs = '') =>
  http()
    .get(`${API}/recruiter/jobs/${jobId}/applications${qs ? `?${qs}` : ''}`)
    .set(bearer(token));
const setStatus = (token: string, id: string, status: string) =>
  http()
    .patch(`${API}/recruiter/applications/${id}/status`)
    .set(bearer(token))
    .send({ status });

beforeAll(async () => {
  testApp = await createTestApp([
    { provide: CloudinaryService, useValue: fakeCloudinary },
  ]);
  app = testApp.app;
  const prisma = app.get(PrismaService);

  recruiterA = await signup(app, 'recruiter.a@example.com', 'RECRUITER');
  recruiterB = await signup(app, 'recruiter.b@example.com', 'RECRUITER');
  recruiterNoCompany = await signup(
    app,
    'recruiter.none@example.com',
    'RECRUITER',
  );
  candidate1 = await signup(app, 'candidate1@example.com', 'CANDIDATE');
  candidate2 = await signup(app, 'candidate2@example.com', 'CANDIDATE');
  candidate3 = await signup(app, 'candidate3@example.com', 'CANDIDATE');

  await http()
    .post(`${API}/companies`)
    .set(bearer(recruiterA.token))
    .send({ name: 'Company A' });
  await http()
    .post(`${API}/companies`)
    .set(bearer(recruiterB.token))
    .send({ name: 'Company B' });

  jobs.open = await createJob(recruiterA.token, 'Open job one');
  jobs.open2 = await createJob(recruiterA.token, 'Open job two');
  jobs.draft = await createJob(recruiterA.token, 'Draft job');
  jobs.closed = await createJob(recruiterA.token, 'Closed job');
  jobs.expired = await createJob(recruiterA.token, 'Expired job');
  for (const id of [jobs.open, jobs.open2, jobs.closed, jobs.expired]) {
    await post(recruiterA.token, id, 'publish');
  }
  await post(recruiterA.token, jobs.closed, 'close');
  // still PUBLISHED, but past its expiry date (the expiry task does not exist yet)
  await prisma.job.update({
    where: { id: jobs.expired },
    data: { expiresAt: new Date(Date.now() - DAY_MS) },
  });

  const emitter = app.get(EventEmitter2);
  emitter.on('application.created', (payload: CreatedEvent) =>
    createdEvents.push(payload),
  );
  emitter.on('application.status_changed', (payload: StatusEvent) =>
    statusEvents.push(payload),
  );
});

afterAll(async () => {
  await testApp?.close();
});

describe('access', () => {
  it('requires authentication to apply', async () => {
    const res = await http().post(`${API}/jobs/${jobs.open}/applications`);
    expect(res.status).toBe(401);
  });

  it('forbids recruiters from applying', async () => {
    const res = await apply(recruiterA.token, jobs.open);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AUTH_FORBIDDEN');
  });

  it('forbids candidates from the recruiter list', async () => {
    const res = await forJob(candidate1.token, jobs.open);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AUTH_FORBIDDEN');
  });
});

describe('apply', () => {
  it('creates an application with status NEW and stores the CV', async () => {
    const res = await apply(candidate1.token, jobs.open, {
      coverLetter: 'Bonjour, je suis motivé.',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      jobId: jobs.open,
      status: 'NEW',
      coverLetter: 'Bonjour, je suis motivé.',
      cvSize: pdf.length,
    });
    expect(res.body.cvUrl).toMatch(
      /^https:\/\/res\.example\.test\/cv-\d+\.pdf$/,
    );
    expect(res.body.cvPublicId).toBeUndefined();
    expect(uploads).toBe(1);
    app1 = res.body.id as string;
  });

  it('rejects a second application to the same job without uploading anything', async () => {
    const res = await apply(candidate1.token, jobs.open);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPLICATION_ALREADY_EXISTS');
    expect(uploads).toBe(1);
  });

  it('lets another candidate apply, with no cover letter', async () => {
    const res = await apply(candidate2.token, jobs.open);
    expect(res.status).toBe(201);
    expect(res.body.coverLetter).toBeNull();
    app2 = res.body.id as string;
  });

  it('lets the same candidate apply to another job', async () => {
    const res = await apply(candidate1.token, jobs.open2);
    expect(res.status).toBe(201);
  });

  it('returns 404 for a draft job and an unknown job', async () => {
    const draft = await apply(candidate1.token, jobs.draft);
    expect(draft.status).toBe(404);
    expect(draft.body.code).toBe('JOB_NOT_FOUND');
    const unknown = await apply(
      candidate1.token,
      '00000000-0000-0000-0000-000000000000',
    );
    expect(unknown.status).toBe(404);
  });

  it('rejects closed jobs and PUBLISHED jobs past expiresAt', async () => {
    for (const id of [jobs.closed, jobs.expired]) {
      const res = await apply(candidate2.token, id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('JOB_NOT_OPEN');
    }
  });

  it('requires a file', async () => {
    const res = await apply(candidate3.token, jobs.open, {
      file: null,
      coverLetter: 'hello',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_REQUIRED');
  });

  it('rejects content that is not a PDF even if declared as one', async () => {
    const res = await apply(candidate3.token, jobs.open, {
      file: Buffer.from('definitely not a pdf'),
    });
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('FILE_INVALID_TYPE');
  });

  it('rejects a real PDF declared with another type', async () => {
    const res = await apply(candidate3.token, jobs.open, {
      contentType: 'image/png',
    });
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('FILE_INVALID_TYPE');
  });

  it('rejects files over 5 MB', async () => {
    const big = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.alloc(5 * 1024 * 1024),
    ]);
    const res = await apply(candidate3.token, jobs.open, { file: big });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects a cover letter over 5000 characters', async () => {
    const res = await apply(candidate3.token, jobs.open, {
      coverLetter: 'a'.repeat(5001),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('does not upload anything for rejected requests', () => {
    // successful uploads so far: candidate1 x2, candidate2 x1
    expect(uploads).toBe(3);
    expect(destroyed).toEqual([]);
  });

  it('accepts exactly one of two simultaneous applications and leaves no orphan CV', async () => {
    const uploadsBefore = uploads;
    const destroyedBefore = destroyed.length;
    const results = await Promise.all([
      apply(candidate3.token, jobs.open2),
      apply(candidate3.token, jobs.open2),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(results.find((res) => res.status === 409)?.body.code).toBe(
      'APPLICATION_ALREADY_EXISTS',
    );
    // every uploaded CV is either kept by the application or deleted again
    expect(uploads - uploadsBefore - (destroyed.length - destroyedBefore)).toBe(
      1,
    );
    for (const entry of destroyed.slice(destroyedBefore)) {
      expect(entry.resourceType).toBe('raw');
    }
  });
});

describe('my applications', () => {
  it('requires authentication and the CANDIDATE role', async () => {
    expect((await http().get(`${API}/applications/me`)).status).toBe(401);
    expect((await mine(recruiterA.token)).status).toBe(403);
  });

  it('lists own applications, newest first, with the job and its open state', async () => {
    const res = await mine(candidate1.token);
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{
      jobId: string;
      job: { title: string; isOpen: boolean; company: { name: string } };
    }>;
    expect(items.map((item) => item.jobId)).toEqual([jobs.open2, jobs.open]);
    expect(items[0].job).toMatchObject({ title: 'Open job two', isOpen: true });
    expect(items[0].job.company.name).toBe('Company A');
    expect(res.body.candidate).toBeUndefined();
  });

  it("never shows another candidate's applications", async () => {
    const res = await mine(candidate2.token);
    expect(
      (res.body.items as Array<{ jobId: string }>).map((item) => item.jobId),
    ).toEqual([jobs.open]);
  });

  it('filters by status', async () => {
    expect(
      (await mine(candidate1.token, 'status=NEW')).body.items,
    ).toHaveLength(2);
    expect((await mine(candidate1.token, 'status=HIRED')).body.items).toEqual(
      [],
    );
  });

  it('paginates with a cursor', async () => {
    const first = await mine(candidate1.token, 'limit=1');
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await mine(
      candidate1.token,
      `limit=1&cursor=${first.body.nextCursor}`,
    );
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    expect(
      [first.body.items[0].jobId, second.body.items[0].jobId].sort(),
    ).toEqual([jobs.open, jobs.open2].sort());
  });

  it('rejects an invalid limit or status', async () => {
    expect((await mine(candidate1.token, 'limit=0')).status).toBe(400);
    const badStatus = await mine(candidate1.token, 'status=MAYBE');
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('recruiter applications', () => {
  it('lists the applications of an own job with candidate info and CV link', async () => {
    const res = await forJob(recruiterA.token, jobs.open);
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{
      id: string;
      cvUrl: string;
      candidate: { email: string; firstName: string; passwordHash?: string };
    }>;
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.candidate.email).sort()).toEqual([
      'candidate1@example.com',
      'candidate2@example.com',
    ]);
    expect(items[0].cvUrl).toMatch(/^https:\/\/res\.example\.test\//);
    expect(items[0].candidate.firstName).toBe('Test');
    expect(items[0].candidate.passwordHash).toBeUndefined();
  });

  it("hides another company's job and unknown jobs behind a 404", async () => {
    for (const token of [recruiterB.token, recruiterNoCompany.token]) {
      const res = await forJob(token, jobs.open);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('JOB_NOT_FOUND');
    }
    expect(
      (await forJob(recruiterA.token, '00000000-0000-0000-0000-000000000000'))
        .status,
    ).toBe(404);
  });

  it('filters by status', async () => {
    expect(
      (await forJob(recruiterA.token, jobs.open, 'status=NEW')).body.items,
    ).toHaveLength(2);
    expect(
      (await forJob(recruiterA.token, jobs.open, 'status=HIRED')).body.items,
    ).toEqual([]);
  });
});

describe('status workflow', () => {
  it('forbids candidates and hides the application from other companies', async () => {
    expect((await setStatus(candidate1.token, app1, 'REVIEWED')).status).toBe(
      403,
    );
    for (const token of [recruiterB.token, recruiterNoCompany.token]) {
      const res = await setStatus(token, app1, 'REVIEWED');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('APPLICATION_NOT_FOUND');
    }
  });

  it('returns 404 for an unknown application and 400 for an invalid status', async () => {
    expect(
      (
        await setStatus(
          recruiterA.token,
          '00000000-0000-0000-0000-000000000000',
          'REVIEWED',
        )
      ).status,
    ).toBe(404);
    const invalid = await setStatus(recruiterA.token, app1, 'MAYBE');
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('VALIDATION_ERROR');
  });

  it('moves NEW -> REVIEWED and returns the candidate', async () => {
    const res = await setStatus(recruiterA.token, app1, 'REVIEWED');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REVIEWED');
    expect(res.body.candidate.email).toBe('candidate1@example.com');
  });

  it('rejects staying in the same status and going back', async () => {
    for (const status of ['REVIEWED', 'NEW']) {
      const res = await setStatus(recruiterA.token, app1, status);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('APPLICATION_INVALID_TRANSITION');
    }
  });

  it('moves REVIEWED -> INTERVIEW -> HIRED', async () => {
    expect(
      (await setStatus(recruiterA.token, app1, 'INTERVIEW')).body.status,
    ).toBe('INTERVIEW');
    expect((await setStatus(recruiterA.token, app1, 'HIRED')).body.status).toBe(
      'HIRED',
    );
  });

  it('treats HIRED as final', async () => {
    const res = await setStatus(recruiterA.token, app1, 'REJECTED');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPLICATION_INVALID_TRANSITION');
  });

  it('rejects NEW -> HIRED, allows NEW -> REJECTED, then treats REJECTED as final', async () => {
    const skip = await setStatus(recruiterA.token, app2, 'HIRED');
    expect(skip.status).toBe(409);
    expect(skip.body.code).toBe('APPLICATION_INVALID_TRANSITION');
    expect((await setStatus(recruiterA.token, app2, 'REJECTED')).status).toBe(
      200,
    );
    expect((await setStatus(recruiterA.token, app2, 'INTERVIEW')).status).toBe(
      409,
    );
  });

  it('shows the new status to the candidate', async () => {
    const hired = await mine(candidate1.token, 'status=HIRED');
    expect(
      (hired.body.items as Array<{ id: string }>).map((item) => item.id),
    ).toEqual([app1]);
    const rejected = await mine(candidate2.token, 'status=REJECTED');
    expect(
      (rejected.body.items as Array<{ id: string }>).map((item) => item.id),
    ).toEqual([app2]);
  });

  it('keeps recruiters able to review applications of a closed job', async () => {
    // closing a job must not lock its applications
    const res = await forJob(recruiterA.token, jobs.closed);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});

describe('domain events', () => {
  it('emitted application.created once per accepted application', () => {
    expect(createdEvents).toHaveLength(4); // candidate1 x2, candidate2, candidate3
    const first = createdEvents.find((event) => event.applicationId === app1);
    expect(first).toMatchObject({
      jobId: jobs.open,
      candidateId: candidate1.id,
    });
    expect(first?.companyId).toBeTruthy();
  });

  it('emitted application.status_changed only for accepted transitions', () => {
    expect(
      statusEvents
        .filter((event) => event.applicationId === app1)
        .map((e) => `${e.from}>${e.to}`),
    ).toEqual(['NEW>REVIEWED', 'REVIEWED>INTERVIEW', 'INTERVIEW>HIRED']);
    expect(
      statusEvents
        .filter((event) => event.applicationId === app2)
        .map((e) => `${e.from}>${e.to}`),
    ).toEqual(['NEW>REJECTED']);
    expect(statusEvents).toHaveLength(4);
  });
});
