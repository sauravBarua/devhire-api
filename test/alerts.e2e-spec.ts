/* eslint-disable @typescript-eslint/no-unsafe-member-access --
   supertest response bodies are untyped (any) */
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CloudinaryService } from '../src/infra/cloudinary/cloudinary.service';
import {
  MailerService,
  type MailMessage,
} from '../src/infra/mailer/mailer.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { AlertsService } from '../src/modules/alerts/alerts.service';
import { JobExpiryService } from '../src/modules/jobs/job-expiry.service';
import { SKILLS } from '../src/modules/skills/skills.data';
import { createTestApp, signup, type TestApp } from './support/test-app';

const API = '/api/v1';
const DAY_MS = 24 * 60 * 60 * 1000;

const sent: MailMessage[] = [];
let failNext = 0;
const fakeMailer = {
  send: (message: MailMessage) => {
    if (failNext > 0) {
      failNext -= 1;
      return Promise.reject(new Error('smtp down'));
    }
    sent.push(message);
    return Promise.resolve();
  },
};
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

const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(128, 'a')]);

const baseJob = {
  description:
    'Rejoignez une équipe produit pour construire des API fiables et maintenables.',
  category: 'BACKEND',
  contractType: 'CDI',
  remotePolicy: 'HYBRID',
  experienceLevel: 'MID',
  city: 'Paris',
};

const RECRUITER_EMAIL = 'recruiter@example.com';
const C1 = 'candidate1@example.com';
const C2 = 'candidate2@example.com';
const C3 = 'candidate3@example.com';
const C4 = 'candidate4@example.com';

let testApp: TestApp;
let app: INestApplication;
let prisma: PrismaService;
let emitter: EventEmitter2;
let recruiter: { token: string; id: string };
let candidate1: { token: string; id: string };
let companyId: string;
let nodeJobId: string;
const events: Array<{ name: string; jobId: string }> = [];

const http = () => request(app.getHttpServer() as Server);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const mailsTo = (email: string, subjectPart = '') =>
  sent.filter(
    (mail) => mail.to === email && mail.subject.includes(subjectPart),
  );
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => sleep(600);

async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error('Timed out waiting for a condition');
}

async function createJob(overrides: object): Promise<string> {
  const res = await http()
    .post(`${API}/recruiter/jobs`)
    .set(bearer(recruiter.token))
    .send({ ...baseJob, title: 'Développeur', skills: [], ...overrides });
  expect(res.status).toBe(201);
  return res.body.id as string;
}
const action = (id: string, name: 'publish' | 'close' | 'renew') =>
  http()
    .post(`${API}/recruiter/jobs/${id}/${name}`)
    .set(bearer(recruiter.token));
const createSearch = (token: string, body: object) =>
  http().post(`${API}/saved-searches`).set(bearer(token)).send(body);

beforeAll(async () => {
  testApp = await createTestApp([
    { provide: MailerService, useValue: fakeMailer },
    { provide: CloudinaryService, useValue: fakeCloudinary },
  ]);
  app = testApp.app;
  prisma = app.get(PrismaService);
  emitter = app.get(EventEmitter2);
  for (const name of [
    'job.published',
    'job.closed',
    'job.expired',
    'job.renewed',
    'job.expiring_soon',
  ]) {
    emitter.on(name, (payload: { jobId: string }) =>
      events.push({ name, jobId: payload.jobId }),
    );
  }
  await prisma.skill.createMany({ data: SKILLS });

  recruiter = await signup(app, RECRUITER_EMAIL, 'RECRUITER');
  candidate1 = await signup(app, C1, 'CANDIDATE');
  const candidate2 = await signup(app, C2, 'CANDIDATE');
  const candidate3 = await signup(app, C3, 'CANDIDATE');
  const candidate4 = await signup(app, C4, 'CANDIDATE');
  const company = await http()
    .post(`${API}/companies`)
    .set(bearer(recruiter.token))
    .send({ name: 'Société Alpha' });
  companyId = company.body.id as string;

  const node = { category: 'backend', skills: 'nodejs' };
  await createSearch(candidate1.token, {
    name: 'Node instantané',
    filters: node,
    frequency: 'INSTANT',
  });
  await createSearch(candidate2.token, {
    name: 'Node quotidien',
    filters: node,
    frequency: 'DAILY',
  });
  await createSearch(candidate3.token, {
    name: 'Node désactivé',
    filters: node,
    frequency: 'INSTANT',
    alertsEnabled: false,
  });
  await createSearch(candidate4.token, {
    name: 'Front instantané',
    filters: { category: 'frontend' },
    frequency: 'INSTANT',
  });
});

afterAll(async () => {
  await testApp?.close();
});

describe('instant and daily alerts', () => {
  it('sends an instant alert only to the matching INSTANT search', async () => {
    nodeJobId = await createJob({
      title: 'Développeur Node.js',
      skills: ['nodejs'],
    });
    expect((await action(nodeJobId, 'publish')).status).toBe(200);

    await waitFor(() => mailsTo(C1).length === 1);
    const mail = mailsTo(C1)[0];
    expect(mail.subject).toBe('Nouvelle offre pour « Node instantané »');
    expect(mail.html).toContain('Développeur Node.js');
    expect(mail.html).toContain(`http://localhost:3001/jobs/${nodeJobId}`);
    expect(mail.text).toContain('Société Alpha');

    await settle();
    expect(mailsTo(C2)).toHaveLength(0); // DAILY: waits for the digest
    expect(mailsTo(C3)).toHaveLength(0); // alerts disabled
    expect(mailsTo(C4)).toHaveLength(0); // different criteria
  });

  it('stores one pending match for the DAILY search and none for the disabled or non-matching ones', async () => {
    const pending = await prisma.alertMatch.findMany({
      where: { notifiedAt: null },
      include: { savedSearch: { select: { name: true } } },
    });
    expect(pending.map((match) => match.savedSearch.name)).toEqual([
      'Node quotidien',
    ]);
    expect(await prisma.alertMatch.count()).toBe(2);
  });

  it('sends the daily digest to the DAILY search only once', async () => {
    const digests = app.get(AlertsService);
    expect(await digests.enqueueDailyDigests()).toBe(1);

    await waitFor(() => mailsTo(C2).length === 1);
    expect(mailsTo(C2)[0].subject).toBe(
      'Nouvelle offre pour « Node quotidien »',
    );

    await settle();
    expect(await digests.enqueueDailyDigests()).toBe(0);
    await settle();
    expect(mailsTo(C2)).toHaveLength(1);
    expect(mailsTo(C1)).toHaveLength(1);
  });

  it('never re-sends the same job to the same search', async () => {
    emitter.emit('job.published', {
      jobId: nodeJobId,
      companyId,
      occurredAt: new Date(),
    });
    await settle();
    expect(mailsTo(C1)).toHaveLength(1);
    expect(mailsTo(C2)).toHaveLength(1);
    expect(await prisma.alertMatch.count()).toBe(2);

    // closing and renewing does not create a new alert either
    expect((await action(nodeJobId, 'close')).status).toBe(200);
    expect((await action(nodeJobId, 'renew')).status).toBe(200);
    await settle();
    expect(mailsTo(C1)).toHaveLength(1);
    expect(await prisma.alertMatch.count()).toBe(2);
  });

  it('alerts only the search that matches a different job', async () => {
    const reactJobId = await createJob({
      title: 'Développeur React',
      category: 'FRONTEND',
      skills: ['react'],
    });
    expect((await action(reactJobId, 'publish')).status).toBe(200);

    await waitFor(() => mailsTo(C4).length === 1);
    expect(mailsTo(C4)[0].subject).toBe(
      'Nouvelle offre pour « Front instantané »',
    );
    await settle();
    expect(mailsTo(C1)).toHaveLength(1);
    expect(mailsTo(C2)).toHaveLength(1);
  });

  it('retries a failed email, sends it once and escapes the job title', async () => {
    failNext = 1;
    const jobId = await createJob({
      title: 'Dev <script>alert(1)</script> Node.js',
      skills: ['nodejs'],
    });
    expect((await action(jobId, 'publish')).status).toBe(200);

    await waitFor(() => mailsTo(C1).length === 2);
    const mail = mailsTo(C1)[1];
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');

    await settle();
    expect(mailsTo(C1)).toHaveLength(2);
    const instant = await prisma.alertMatch.findFirst({
      where: { jobId, savedSearch: { name: 'Node instantané' } },
    });
    expect(instant?.notifiedAt).not.toBeNull();
    // the DAILY search keeps its match pending until the digest runs
    const daily = await prisma.alertMatch.findFirst({
      where: { jobId, savedSearch: { name: 'Node quotidien' } },
    });
    expect(daily?.notifiedAt).toBeNull();
  });
});

describe('job expiry task', () => {
  it('moves due jobs to EXPIRED once, sets closedAt and emits job.expired', async () => {
    const jobId = await createJob({ title: 'Offre à expirer' });
    await action(jobId, 'publish');
    await prisma.job.update({
      where: { id: jobId },
      data: { expiresAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const expiry = app.get(JobExpiryService);
    expect(await expiry.expireDueJobs()).toBe(1);

    const res = await http().get(`${API}/jobs/${jobId}`);
    expect(res.body).toMatchObject({ status: 'EXPIRED', isOpen: false });
    expect(res.body.closedAt).not.toBeNull();
    expect(
      events.filter((e) => e.name === 'job.expired' && e.jobId === jobId),
    ).toHaveLength(1);

    expect(await expiry.expireDueJobs()).toBe(0);
    expect(
      events.filter((e) => e.name === 'job.expired' && e.jobId === jobId),
    ).toHaveLength(1);
  });

  it('leaves live jobs alone and drops expired jobs from search results', async () => {
    const live = await http().get(`${API}/jobs/${nodeJobId}`);
    expect(live.body.status).toBe('PUBLISHED');
    const search = await http().get(`${API}/jobs?q=expirer`);
    expect(search.body.items).toEqual([]);
  });

  it('sends the expiry reminder once per publication period', async () => {
    const jobId = await createJob({ title: 'Offre bientôt expirée' });
    await action(jobId, 'publish');
    await prisma.job.update({
      where: { id: jobId },
      data: { expiresAt: new Date(Date.now() + 2 * DAY_MS) },
    });
    const farId = await createJob({ title: 'Offre lointaine' });
    await action(farId, 'publish'); // expires in 30 days, outside the reminder window

    const expiry = app.get(JobExpiryService);
    expect(await expiry.flagExpiringSoon()).toBe(1);
    await waitFor(
      () => mailsTo(RECRUITER_EMAIL, 'bientôt expirée').length === 1,
    );
    const mail = mailsTo(RECRUITER_EMAIL, 'bientôt expirée')[0];
    expect(mail.subject).toBe(
      'Votre offre « Offre bientôt expirée » expire dans 2 jours',
    );
    expect(mail.text).toContain(
      `http://localhost:3001/recruiter/jobs/${jobId}`,
    );
    expect(mail.text).toContain('renouveler');

    expect(await expiry.flagExpiringSoon()).toBe(0);
    await settle();
    expect(mailsTo(RECRUITER_EMAIL, 'bientôt expirée')).toHaveLength(1);
    expect(mailsTo(RECRUITER_EMAIL, 'lointaine')).toHaveLength(0);

    // a renewal starts a new period, so a later reminder is possible again
    await action(jobId, 'close');
    await action(jobId, 'renew');
    expect(
      (await prisma.job.findUniqueOrThrow({ where: { id: jobId } }))
        .expiryReminderSentAt,
    ).toBeNull();
    await prisma.job.update({
      where: { id: jobId },
      data: { expiresAt: new Date(Date.now() + 2 * DAY_MS) },
    });
    expect(await expiry.flagExpiringSoon()).toBe(1);
  });
});

describe('new application email', () => {
  it('notifies the company recruiter when a candidate applies', async () => {
    const res = await http()
      .post(`${API}/jobs/${nodeJobId}/applications`)
      .set(bearer(candidate1.token))
      .attach('cv', pdf, {
        filename: 'cv.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(201);

    await waitFor(
      () => mailsTo(RECRUITER_EMAIL, 'Nouvelle candidature').length === 1,
    );
    const mail = mailsTo(RECRUITER_EMAIL, 'Nouvelle candidature')[0];
    expect(mail.subject).toBe(
      'Nouvelle candidature pour « Développeur Node.js »',
    );
    expect(mail.html).toContain('Test User');
    expect(mail.text).toContain(
      `http://localhost:3001/recruiter/jobs/${nodeJobId}/applications`,
    );

    await settle();
    expect(mailsTo(RECRUITER_EMAIL, 'Nouvelle candidature')).toHaveLength(1);
  });

  it('sends nothing for a rejected application', async () => {
    const duplicate = await http()
      .post(`${API}/jobs/${nodeJobId}/applications`)
      .set(bearer(candidate1.token))
      .attach('cv', pdf, {
        filename: 'cv.pdf',
        contentType: 'application/pdf',
      });
    expect(duplicate.status).toBe(409);
    await settle();
    expect(mailsTo(RECRUITER_EMAIL, 'Nouvelle candidature')).toHaveLength(1);
  });
});
