import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import type { SearchQuery } from './dto/search.dto';

export type SearchSort = 'relevance' | 'date';

export interface SearchFilters {
  q: string | null;
  category: string[];
  contractType: string[];
  remotePolicy: string[];
  experienceLevel: string[];
  skills: string[];
  city: string | null;
  region: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  postedHours: number | null;
  sort: SearchSort;
}

const POSTED_HOURS = { '24h': 24, '7d': 168, '14d': 336, '30d': 720 } as const;

const sorted = (values: readonly string[] | undefined): string[] =>
  [...(values ?? [])].sort();

// canonical form: sorted arrays and an effective sort, so equal searches share one cache key
export function normalizeFilters(query: SearchQuery): SearchFilters {
  const q = query.q && query.q.length > 0 ? query.q : null;
  const requested = query.sort ?? (q ? 'relevance' : 'date');
  return {
    q,
    category: sorted(query.category),
    contractType: sorted(query.contractType),
    remotePolicy: sorted(query.remotePolicy),
    experienceLevel: sorted(query.experienceLevel),
    skills: sorted(query.skills),
    city: query.city ?? null,
    region: query.region ?? null,
    salaryMin: query.salaryMin ?? null,
    salaryMax: query.salaryMax ?? null,
    postedHours: query.postedWithin ? POSTED_HOURS[query.postedWithin] : null,
    // relevance needs a text query; without one, fall back to date
    sort: requested === 'relevance' && q !== null ? 'relevance' : 'date',
  };
}

export interface Cursor {
  sort: SearchSort;
  rank: number | null;
  publishedAt: string;
  id: string;
}

const cursorSchema = z.object({
  s: z.enum(['relevance', 'date']),
  r: z.number().nullable(),
  p: z.iso.datetime(),
  i: z.string().min(1).max(64),
});

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(
    JSON.stringify({
      s: cursor.sort,
      r: cursor.rank,
      p: cursor.publishedAt,
      i: cursor.id,
    }),
  ).toString('base64url');
}

export function decodeCursor(token: string, sort: SearchSort): Cursor {
  const invalid = (): AppException =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      'INVALID_CURSOR',
      'Invalid pagination cursor',
    );

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  const parsed = cursorSchema.safeParse(raw);
  if (!parsed.success || parsed.data.s !== sort) throw invalid();
  if (sort === 'relevance' && parsed.data.r === null) throw invalid();
  return {
    sort,
    rank: parsed.data.r,
    publishedAt: parsed.data.p,
    id: parsed.data.i,
  };
}

export function makeExcerpt(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 3).trimEnd()}...` : flat;
}
