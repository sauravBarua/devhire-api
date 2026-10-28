/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment --
   supertest response bodies are untyped (any) */
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  ContractType,
  ExperienceLevel,
  JobCategory,
  RemotePolicy,
} from '../src/generated/prisma/enums';
import { JobStatus } from '../src/generated/prisma/enums';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { RedisService } from '../src/infra/redis/redis.service';
import { SKILLS } from '../src/modules/skills/skills.data';
import { createTestApp, signup, type TestApp } from './support/test-app';

const API = '/api/v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);
const daysAhead = (days: number): Date => new Date(Date.now() + days * DAY_MS);

interface Spec {
  key: string;
  title: string;
  description: string;
  category?: JobCategory;
  contractType?: ContractType;
  remotePolicy?: RemotePolicy;
  experienceLevel?: ExperienceLevel;
  city?: string;
  salary?: [number, number];
  skills?: string[];
  status?: JobStatus;
  publishedAt?: Date | null;
  expiresAt?: Date | null;
  closedAt?: Date | null;
  company?: 'A' | 'B';
}

// 7 valid jobs (J1-J5, J10, J11) and 4 that must never be searchable (J6 draft, J7 closed, J8 expired,
// J9 published but past expiresAt)
const SPECS: Spec[] = [
  {
    key: 'J1',
    title: 'Développeur Node.js backend',
    description:
      'Vous développerez des API avec Node.js et TypeScript au sein de notre équipe produit.',
    remotePolicy: 'FULL_REMOTE',
    city: 'Paris',
    salary: [50000, 70000],
    skills: ['nodejs', 'typescript'],
    publishedAt: daysAgo(2),
    company: 'A',
  },
  {
    key: 'J2',
    title: 'Développeur Java Spring',
    description:
      'Vous concevrez des services Java robustes avec Spring dans un contexte bancaire.',
    city: 'Lyon',
    salary: [45000, 60000],
    skills: ['java', 'spring'],
    publishedAt: daysAgo(3),
  },
  {
    key: 'J3',
    title: 'Développeur Python Django',
    description:
      'Vous construirez des applications web avec Python et Django pour nos clients.',
    city: 'Lyon',
    skills: ['python', 'django'],
    publishedAt: daysAgo(5),
  },
  {
    key: 'J4',
    title: '.NET backend engineer',
    description:
      'You will build backend services with C# on the .NET platform.',
    remotePolicy: 'ON_SITE',
    city: 'Nantes',
    skills: ['dotnet', 'csharp'],
    publishedAt: daysAgo(6),
  },
  {
    key: 'J5',
    title: 'Ingénieur Fullstack React / Node',
    description:
      'Vous travaillerez sur le front avec React et sur le back avec Node.js.',
    category: 'FULLSTACK',
    city: 'Paris',
    skills: ['react', 'nodejs'],
    publishedAt: daysAgo(10),
    company: 'A',
  },
  {
    key: 'J10',
    title: 'Développeur Frontend React',
    description:
      'Vous intégrerez la squad front pour faire évoluer notre application React.',
    category: 'FRONTEND',
    contractType: 'ALTERNANCE',
    remotePolicy: 'ON_SITE',
    experienceLevel: 'JUNIOR',
    city: 'Paris',
    salary: [35000, 45000],
    skills: ['react', 'typescript'],
    publishedAt: daysAgo(40),
    expiresAt: daysAhead(5),
  },
  {
    key: 'J11',
    title: 'Consultant technique',
    description:
      'Mission de conseil, la stack du client est principalement basée sur Node.js.',
    remotePolicy: 'ON_SITE',
    city: 'Lyon',
    skills: [],
    publishedAt: daysAgo(1),
  },
  {
    key: 'J6',
    title: 'Développeur Node.js brouillon',
    description:
      'Brouillon non publié avec Node.js, ne doit jamais apparaître.',
    skills: ['nodejs'],
    status: JobStatus.DRAFT,
    publishedAt: null,
    expiresAt: null,
  },
  {
    key: 'J7',
    title: 'Développeur Node.js clôturé',
    description:
      'Offre clôturée avec Node.js, visible uniquement par lien direct.',
    skills: ['nodejs'],
    status: JobStatus.CLOSED,
    publishedAt: daysAgo(20),
    expiresAt: daysAhead(10),
    closedAt: daysAgo(5),
  },
  {
    key: 'J8',
    title: 'Développeur Node.js expiré',
    description:
      'Offre expirée avec Node.js, visible uniquement par lien direct.',
    skills: ['nodejs'],
    status: JobStatus.EXPIRED,
    publishedAt: daysAgo(50),
    expiresAt: daysAgo(20),
    closedAt: daysAgo(20),
  },
  {
    key: 'J9',
    title: 'Développeur Node.js périmé',
    description:
      "Publiée mais déjà expirée, l'expiration automatique n'a pas encore tourné.",
    skills: ['nodejs'],
    publishedAt: daysAgo(40),
    expiresAt: daysAgo(1),
  },
];

const ids: Record<string, string> = {};
let testApp: TestApp;
let app: INestApplication;
let recruiterA: { token: string; id: string };

const http = () => request(app.getHttpServer() as Server);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const search = (qs = '') => http().get(`${API}/jobs${qs ? `?${qs}` : ''}`);
const idsOf = (res: { body: { items: Array<{ id: string }> } }): string[] =>
  res.body.items.map((item) => item.id);
const keys = (...names: string[]): string[] => names.map((name) => ids[name]);
const sortedKeys = (...names: string[]): string[] => keys(...names).sort();

interface FacetEntry {
  value: string;
  count: number;
  label?: string;
}

interface Facets {
  category: FacetEntry[];
  contractType: FacetEntry[];
  remotePolicy: FacetEntry[];
  experienceLevel: FacetEntry[];
  skills: FacetEntry[];
  cities: FacetEntry[];
}

const facetsOf = (res: { body: { facets: Facets } }): Facets => res.body.facets;
const countOf = (list: FacetEntry[], value: string): number | undefined =>
  list.find((entry) => entry.value === value)?.count;

beforeAll(async () => {
  testApp = await createTestApp();
  app = testApp.app;
  const prisma = app.get(PrismaService);

  await prisma.skill.createMany({ data: SKILLS });
  const skillRows = await prisma.skill.findMany({
    select: { id: true, slug: true },
  });
  const skillId = new Map(skillRows.map((row) => [row.slug, row.id]));

  recruiterA = await signup(app, 'recruiter.a@example.com', 'RECRUITER');
  const recruiterB = await signup(app, 'recruiter.b@example.com', 'RECRUITER');
  const companyA = await http()
    .post(`${API}/companies`)
    .set(bearer(recruiterA.token))
    .send({ name: 'Société Alpha' });
  const companyB = await http()
    .post(`${API}/companies`)
    .set(bearer(recruiterB.token))
    .send({ name: 'Société Beta' });
  const companyIds = {
    A: companyA.body.id as string,
    B: companyB.body.id as string,
  };

  for (const spec of SPECS) {
    const job = await prisma.job.create({
      data: {
        companyId: companyIds[spec.company ?? 'B'],
        title: spec.title,
        description: spec.description,
        category: spec.category ?? 'BACKEND',
        contractType: spec.contractType ?? 'CDI',
        remotePolicy: spec.remotePolicy ?? 'HYBRID',
        experienceLevel: spec.experienceLevel ?? 'MID',
        city: spec.city,
        salaryMin: spec.salary?.[0],
        salaryMax: spec.salary?.[1],
        status: spec.status ?? JobStatus.PUBLISHED,
        publishedAt:
          spec.publishedAt === undefined ? daysAgo(1) : spec.publishedAt,
        expiresAt:
          spec.expiresAt === undefined ? daysAhead(20) : spec.expiresAt,
        closedAt: spec.closedAt ?? null,
        skills: {
          create: (spec.skills ?? []).map((slug) => ({
            skillId: skillId.get(slug) as string,
          })),
        },
      },
    });
    ids[spec.key] = job.id;
  }
});

afterAll(async () => {
  await testApp?.close();
});

describe('text search: AND matching and ranking', () => {
  it('"Node.js" returns only jobs that really have Node.js, never Java, Python or .NET only jobs', async () => {
    const res = await search('q=node.js');
    expect(res.status).toBe(200);
    const found = idsOf(res);
    expect(found).toEqual(expect.arrayContaining(keys('J1', 'J5', 'J11')));
    expect(found).not.toContain(ids.J2); // Java
    expect(found).not.toContain(ids.J3); // Python
    expect(found).not.toContain(ids.J4); // .NET
    expect(found).not.toContain(ids.J10); // React / TypeScript
  });

  it('ranks title (A) above skills (B) above description (D)', async () => {
    const res = await search('q=node.js');
    expect(idsOf(res)).toEqual(keys('J1', 'J5', 'J11'));
  });

  it('matches skill aliases: "nodejs" finds jobs whose skill is Node.js', async () => {
    const res = await search('q=nodejs');
    expect(idsOf(res).sort()).toEqual(sortedKeys('J1', 'J5'));
  });

  it('requires every term (AND): "node.js react" only returns the fullstack job', async () => {
    const res = await search('q=node.js%20react');
    expect(idsOf(res)).toEqual(keys('J5'));
  });

  it('"java" does not return Node.js jobs', async () => {
    const res = await search('q=java');
    expect(idsOf(res)).toEqual(keys('J2'));
  });

  it('is accent-insensitive: "developpeur" matches "Développeur"', async () => {
    const found = idsOf(await search('q=developpeur'));
    expect(found).toEqual(
      expect.arrayContaining(keys('J1', 'J2', 'J3', 'J10')),
    );
    expect(found).not.toContain(ids.J4);
    expect(found).not.toContain(ids.J5);
    expect(found).not.toContain(ids.J11);
  });

  it('returns an empty page for a query with no searchable terms', async () => {
    const res = await search('q=!!!');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});

describe('visibility: only live PUBLISHED jobs', () => {
  it('never returns draft, closed, expired or past-expiresAt jobs, even when they match', async () => {
    const found = idsOf(await search('q=node.js'));
    for (const hidden of ['J6', 'J7', 'J8', 'J9']) {
      expect(found).not.toContain(ids[hidden]);
    }
  });

  it('without a query, lists exactly the 7 live jobs, newest first', async () => {
    const res = await search();
    expect(idsOf(res)).toEqual(
      keys('J11', 'J1', 'J2', 'J3', 'J4', 'J5', 'J10'),
    );
    expect(res.body.total).toBe(7);
  });
});

describe('filters', () => {
  it('filters by category (multi-value, case-insensitive)', async () => {
    expect(idsOf(await search('category=FRONTEND'))).toEqual(keys('J10'));
    const both = idsOf(await search('category=frontend,fullstack'));
    expect(both.sort()).toEqual(sortedKeys('J10', 'J5'));
  });

  it('filters by contract type, remote policy and experience level', async () => {
    expect(idsOf(await search('contractType=ALTERNANCE'))).toEqual(keys('J10'));
    expect(idsOf(await search('remotePolicy=FULL_REMOTE'))).toEqual(keys('J1'));
    expect(idsOf(await search('experienceLevel=JUNIOR'))).toEqual(keys('J10'));
  });

  it('filters by city, ignoring case and accents', async () => {
    expect(idsOf(await search('city=paris')).sort()).toEqual(
      sortedKeys('J1', 'J5', 'J10'),
    );
    expect(idsOf(await search('city=NANTES'))).toEqual(keys('J4'));
  });

  it('filters skills with "all of" semantics', async () => {
    expect(idsOf(await search('skills=react,typescript'))).toEqual(keys('J10'));
    expect(idsOf(await search('skills=react')).sort()).toEqual(
      sortedKeys('J5', 'J10'),
    );
    expect(idsOf(await search('skills=react,java'))).toEqual([]);
    expect(idsOf(await search('skills=unknown-skill'))).toEqual([]);
  });

  it('filters by salary range overlap', async () => {
    expect(idsOf(await search('salaryMin=60000')).sort()).toEqual(
      sortedKeys('J1', 'J2'),
    );
    expect(idsOf(await search('salaryMax=40000'))).toEqual(keys('J10'));
    expect(idsOf(await search('salaryMin=46000&salaryMax=52000'))).toEqual(
      expect.arrayContaining(keys('J1', 'J2')),
    );
  });

  it('filters by posting date based on publishedAt', async () => {
    expect(idsOf(await search('postedWithin=7d')).sort()).toEqual(
      sortedKeys('J11', 'J1', 'J2', 'J3', 'J4'),
    );
    const month = idsOf(await search('postedWithin=30d'));
    expect(month).toContain(ids.J5);
    expect(month).not.toContain(ids.J10); // published 40 days ago
  });

  it('combines filters with AND across filters', async () => {
    const res = await search('category=backend&remotePolicy=hybrid&city=lyon');
    expect(idsOf(res).sort()).toEqual(sortedKeys('J2', 'J3'));
  });

  it('can sort a text search by date', async () => {
    const res = await search('q=node.js&sort=date');
    expect(idsOf(res)).toEqual(keys('J11', 'J1', 'J5'));
  });

  it('rejects invalid filter values', async () => {
    const badWindow = await search('postedWithin=1y');
    expect(badWindow.status).toBe(400);
    expect(badWindow.body.code).toBe('VALIDATION_ERROR');
    expect((await search('category=COOKING')).status).toBe(400);
    expect((await search('limit=0')).status).toBe(400);
    expect((await search('salaryMin=90000&salaryMax=1000')).status).toBe(400);
  });
});

describe('facet counts', () => {
  it('counts every live job once per facet', async () => {
    const facets = facetsOf(await search());
    expect(countOf(facets.category, 'BACKEND')).toBe(5);
    expect(countOf(facets.category, 'FRONTEND')).toBe(1);
    expect(countOf(facets.category, 'FULLSTACK')).toBe(1);
    expect(countOf(facets.remotePolicy, 'ON_SITE')).toBe(3);
    expect(countOf(facets.cities, 'Paris')).toBe(3);
    expect(countOf(facets.cities, 'Lyon')).toBe(3);
    expect(countOf(facets.skills, 'nodejs')).toBe(2);
    expect(facets.skills.find((skill) => skill.value === 'nodejs')?.label).toBe(
      'Node.js',
    );
  });

  it('counts other facets within the current filters but leaves a facet unfiltered by itself', async () => {
    const res = await search('category=FRONTEND');
    expect(idsOf(res)).toEqual(keys('J10'));
    const facets = facetsOf(res);
    // its own facet ignores its own filter, so users can still switch category
    expect(countOf(facets.category, 'BACKEND')).toBe(5);
    // other facets only count the filtered jobs
    expect(facets.remotePolicy).toEqual([{ value: 'ON_SITE', count: 1 }]);
    expect(facets.skills.map((skill) => skill.value).sort()).toEqual([
      'react',
      'typescript',
    ]);
  });

  it('counts facets over the text-search matches', async () => {
    const res = await search('q=node.js');
    expect(res.body.total).toBe(3);
    expect(countOf(facetsOf(res).category, 'FULLSTACK')).toBe(1);
  });
});

describe('cursor pagination', () => {
  it('walks the whole date-sorted list without duplicates or gaps', async () => {
    const first = await search('limit=3');
    expect(first.body.total).toBe(7);
    expect(first.body.facets).not.toBeNull();
    expect(first.body.nextCursor).not.toBeNull();

    const seen = idsOf(first);
    let cursor = first.body.nextCursor as string | null;
    for (let page = 0; cursor && page < 10; page += 1) {
      const res = await search(`limit=3&cursor=${cursor}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBeNull();
      expect(res.body.facets).toBeNull();
      seen.push(...idsOf(res));
      cursor = res.body.nextCursor as string | null;
    }
    expect(seen).toEqual(keys('J11', 'J1', 'J2', 'J3', 'J4', 'J5', 'J10'));
  });

  it('paginates relevance-sorted results in the same order as one big page', async () => {
    const full = idsOf(await search('q=developpeur&limit=50'));
    expect(full.length).toBeGreaterThanOrEqual(4);

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const url: string = `q=developpeur&limit=1${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await search(url);
      expect(res.status).toBe(200);
      seen.push(...idsOf(res));
      cursor = res.body.nextCursor as string | null;
      if (!cursor) break;
    }
    expect(seen).toEqual(full);
  });

  it('rejects a malformed cursor and a cursor from another sort', async () => {
    const malformed = await search('cursor=not-a-cursor');
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('INVALID_CURSOR');

    const dateCursor = (await search('limit=1')).body.nextCursor as string;
    const mismatch = await search(
      `q=node.js&sort=relevance&cursor=${dateCursor}`,
    );
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.code).toBe('INVALID_CURSOR');
  });
});

describe('public job detail', () => {
  it('returns a live job with its company and skills', async () => {
    const res = await http().get(`${API}/jobs/${ids.J1}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: ids.J1,
      status: 'PUBLISHED',
      isOpen: true,
      closedAt: null,
      postedDaysAgo: 2,
    });
    expect(res.body.company.name).toBe('Société Alpha');
    expect(res.body.company.slug).toBe('societe-alpha');
    expect(typeof res.body.description).toBe('string');
    expect(
      (res.body.skills as Array<{ slug: string }>).map((s) => s.slug).sort(),
    ).toEqual(['nodejs', 'typescript']);
  });

  it('keeps closed and expired jobs viewable by direct link, marked as not open', async () => {
    const closed = await http().get(`${API}/jobs/${ids.J7}`);
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ status: 'CLOSED', isOpen: false });
    expect(closed.body.closedAt).not.toBeNull();

    const expired = await http().get(`${API}/jobs/${ids.J8}`);
    expect(expired.status).toBe(200);
    expect(expired.body).toMatchObject({ status: 'EXPIRED', isOpen: false });
  });

  it('marks a PUBLISHED job past expiresAt as not open', async () => {
    const res = await http().get(`${API}/jobs/${ids.J9}`);
    expect(res.status).toBe(200);
    expect(res.body.isOpen).toBe(false);
  });

  it('returns 404 for a draft and for an unknown id', async () => {
    const draft = await http().get(`${API}/jobs/${ids.J6}`);
    expect(draft.status).toBe(404);
    expect(draft.body.code).toBe('JOB_NOT_FOUND');
    expect(
      (await http().get(`${API}/jobs/00000000-0000-0000-0000-000000000000`))
        .status,
    ).toBe(404);
  });

  it('search results carry an excerpt instead of the full description', async () => {
    const res = await search('q=node.js');
    const item = res.body.items[0];
    expect(typeof item.excerpt).toBe('string');
    expect(item.description).toBeUndefined();
    expect(item.company.name).toBeDefined();
  });
});

describe('cache', () => {
  it('serves identical searches from Redis and invalidates on a status change', async () => {
    const first = await search('q=node.js');
    const second = await search('q=node.js');
    expect(second.body).toEqual(first.body);
    expect(idsOf(first)).toContain(ids.J1);

    const cached = await app.get(RedisService).client.keys('search:*');
    expect(cached.length).toBeGreaterThan(0);

    // closing the job emits job.closed, which bumps the cache version
    const close = await http()
      .post(`${API}/recruiter/jobs/${ids.J1}/close`)
      .set(bearer(recruiterA.token));
    expect(close.status).toBe(200);

    const after = await search('q=node.js');
    expect(idsOf(after)).not.toContain(ids.J1);
    expect(idsOf(after)).toEqual(keys('J5', 'J11'));
  });
});
