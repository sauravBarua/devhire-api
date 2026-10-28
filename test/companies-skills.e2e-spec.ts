/* eslint-disable @typescript-eslint/no-unsafe-member-access --
   supertest response bodies are untyped (any) */
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CloudinaryService } from '../src/infra/cloudinary/cloudinary.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { SKILLS } from '../src/modules/skills/skills.data';
import { createTestApp, signup, type TestApp } from './support/test-app';

const API = '/api/v1';

const destroyed: string[] = [];
let uploads = 0;
const fakeCloudinary = {
  uploadImage: (buffer: Buffer, mime: string) => {
    uploads += 1;
    return Promise.resolve({
      publicId: `devhire/logos/test-${uploads}`,
      secureUrl: `https://res.example.test/logo-${uploads}.png`,
      size: buffer.length,
      mime,
    });
  },
  destroy: (publicId: string) => {
    destroyed.push(publicId);
    return Promise.resolve();
  },
};

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const png = Buffer.concat([PNG_HEADER, Buffer.alloc(64)]);

let testApp: TestApp;
let app: INestApplication;
let recruiterA: { token: string; id: string };
let recruiterB: { token: string; id: string };
let recruiterC: { token: string; id: string };
let candidate: { token: string; id: string };

const http = () => request(app.getHttpServer() as Server);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  testApp = await createTestApp([
    { provide: CloudinaryService, useValue: fakeCloudinary },
  ]);
  app = testApp.app;
  recruiterA = await signup(app, 'recruiter.a@example.com', 'RECRUITER');
  recruiterB = await signup(app, 'recruiter.b@example.com', 'RECRUITER');
  recruiterC = await signup(app, 'recruiter.c@example.com', 'RECRUITER');
  candidate = await signup(app, 'candidate@example.com', 'CANDIDATE');
});

afterAll(async () => {
  await testApp?.close();
});

describe('companies', () => {
  it('requires authentication and the RECRUITER role to create', async () => {
    const body = { name: 'Nope Inc' };
    expect((await http().post(`${API}/companies`).send(body)).status).toBe(401);
    const res = await http()
      .post(`${API}/companies`)
      .set(bearer(candidate.token))
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AUTH_FORBIDDEN');
  });

  it('returns 404 for /companies/me before a company exists', async () => {
    const res = await http()
      .get(`${API}/companies/me`)
      .set(bearer(recruiterA.token));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('COMPANY_NOT_FOUND');
  });

  it('creates a company with a slug derived from the name', async () => {
    const res = await http()
      .post(`${API}/companies`)
      .set(bearer(recruiterA.token))
      .send({
        name: 'Acme Études',
        website: 'https://acme.example.com',
        city: 'Paris',
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      slug: 'acme-etudes',
      name: 'Acme Études',
      website: 'https://acme.example.com',
      city: 'Paris',
      logoUrl: null,
    });
    expect(res.body.ownerId).toBeUndefined();
    expect(res.body.logoPublicId).toBeUndefined();
  });

  it('rejects a second company for the same recruiter', async () => {
    const res = await http()
      .post(`${API}/companies`)
      .set(bearer(recruiterA.token))
      .send({ name: 'Another One' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('COMPANY_ALREADY_EXISTS');
  });

  it('validates the payload', async () => {
    const tooShort = await http()
      .post(`${API}/companies`)
      .set(bearer(recruiterB.token))
      .send({ name: 'A' });
    expect(tooShort.status).toBe(400);
    expect(tooShort.body.code).toBe('VALIDATION_ERROR');

    const badUrl = await http()
      .post(`${API}/companies`)
      .set(bearer(recruiterB.token))
      .send({ name: 'Valid Name', website: 'ftp://files.example.com' });
    expect(badUrl.status).toBe(400);
    expect(badUrl.body.code).toBe('VALIDATION_ERROR');
  });

  it('adds a numeric suffix when the slug is taken', async () => {
    const res = await http()
      .post(`${API}/companies`)
      .set(bearer(recruiterB.token))
      .send({ name: 'Acme Etudes' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('acme-etudes-2');
  });

  it('never uses the reserved slug "me"', async () => {
    const res = await http()
      .post(`${API}/companies`)
      .set(bearer(recruiterC.token))
      .send({ name: 'Me' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('me-2');
  });

  it('returns the recruiter own company', async () => {
    const res = await http()
      .get(`${API}/companies/me`)
      .set(bearer(recruiterA.token));
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('acme-etudes');
  });

  it('updates fields and clears a field with null', async () => {
    const res = await http()
      .patch(`${API}/companies/me`)
      .set(bearer(recruiterA.token))
      .send({ city: 'Lyon', website: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      city: 'Lyon',
      website: null,
      name: 'Acme Études',
    });
  });

  it('serves the public company page without a token', async () => {
    const res = await http().get(`${API}/companies/acme-etudes`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Acme Études');
    expect(res.body.ownerId).toBeUndefined();
  });

  it('returns 404 for an unknown slug', async () => {
    const res = await http().get(`${API}/companies/does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('COMPANY_NOT_FOUND');
  });
});

describe('company logo', () => {
  const upload = (
    token: string,
    content: Buffer,
    contentType: string,
    filename = 'logo.png',
  ) =>
    http()
      .post(`${API}/companies/me/logo`)
      .set(bearer(token))
      .attach('file', content, { filename, contentType });

  it('accepts a valid PNG and stores the logo URL', async () => {
    const res = await upload(recruiterA.token, png, 'image/png');
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBe('https://res.example.test/logo-1.png');
    expect(res.body.logoPublicId).toBeUndefined();
  });

  it('deletes the previous logo when replaced', async () => {
    const res = await upload(recruiterA.token, png, 'image/png');
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBe('https://res.example.test/logo-2.png');
    expect(destroyed).toContain('devhire/logos/test-1');
  });

  it('rejects content whose bytes are not an image', async () => {
    const res = await upload(
      recruiterA.token,
      Buffer.from('definitely not a png'),
      'image/png',
    );
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('FILE_INVALID_TYPE');
  });

  it('rejects a PDF', async () => {
    const res = await upload(
      recruiterA.token,
      Buffer.from('%PDF-1.7 content'),
      'application/pdf',
      'cv.pdf',
    );
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('FILE_INVALID_TYPE');
  });

  it('rejects a request without a file', async () => {
    const res = await http()
      .post(`${API}/companies/me/logo`)
      .set(bearer(recruiterA.token));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_REQUIRED');
  });

  it('rejects files over 2 MB', async () => {
    const big = Buffer.concat([PNG_HEADER, Buffer.alloc(2 * 1024 * 1024)]);
    const res = await upload(recruiterA.token, big, 'image/png');
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('forbids candidates', async () => {
    const res = await upload(candidate.token, png, 'image/png');
    expect(res.status).toBe(403);
  });
});

describe('skills', () => {
  beforeAll(async () => {
    await app.get(PrismaService).skill.createMany({ data: SKILLS });
  });

  it('lists skills publicly with their aliases', async () => {
    const res = await http().get(`${API}/skills`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(SKILLS.length);
    const node = (
      res.body as Array<{ slug: string; name: string; aliases: string[] }>
    ).find((skill) => skill.slug === 'nodejs');
    expect(node?.name).toBe('Node.js');
    expect(node?.aliases).toEqual(expect.arrayContaining(['node', 'node.js']));
  });
});
