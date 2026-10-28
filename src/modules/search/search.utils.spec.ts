import { describe, expect, it } from 'vitest';
import { AppException } from '../../common/errors/app.exception';
import type { SearchQuery } from './dto/search.dto';
import {
  decodeCursor,
  encodeCursor,
  makeExcerpt,
  normalizeFilters,
} from './search.utils';

const query = (overrides: Partial<SearchQuery> = {}): SearchQuery => ({
  limit: 20,
  ...overrides,
});

describe('normalizeFilters', () => {
  it('defaults to date sort without a text query', () => {
    expect(normalizeFilters(query()).sort).toBe('date');
  });

  it('defaults to relevance when there is a text query', () => {
    expect(normalizeFilters(query({ q: 'node.js' })).sort).toBe('relevance');
  });

  it('falls back to date when relevance is requested without a query', () => {
    expect(normalizeFilters(query({ sort: 'relevance' })).sort).toBe('date');
  });

  it('keeps an explicit date sort even with a query', () => {
    expect(normalizeFilters(query({ q: 'node', sort: 'date' })).sort).toBe(
      'date',
    );
  });

  it('sorts filter arrays so equal searches have equal keys', () => {
    const a = normalizeFilters(
      query({ category: ['FRONTEND', 'BACKEND'], skills: ['react', 'css'] }),
    );
    const b = normalizeFilters(
      query({ category: ['BACKEND', 'FRONTEND'], skills: ['css', 'react'] }),
    );
    expect(a).toEqual(b);
    expect(a.category).toEqual(['BACKEND', 'FRONTEND']);
  });

  it('maps postedWithin to hours', () => {
    expect(normalizeFilters(query({ postedWithin: '24h' })).postedHours).toBe(
      24,
    );
    expect(normalizeFilters(query({ postedWithin: '7d' })).postedHours).toBe(
      168,
    );
    expect(normalizeFilters(query({ postedWithin: '14d' })).postedHours).toBe(
      336,
    );
    expect(normalizeFilters(query({ postedWithin: '30d' })).postedHours).toBe(
      720,
    );
    expect(normalizeFilters(query()).postedHours).toBeNull();
  });

  it('turns an empty q into null', () => {
    expect(normalizeFilters(query({ q: '' })).q).toBeNull();
  });
});

describe('cursor', () => {
  it('round-trips a relevance cursor', () => {
    const cursor = {
      sort: 'relevance' as const,
      rank: 0.6079271,
      publishedAt: '2026-01-15T10:00:00.000Z',
      id: 'job-1',
    };
    expect(decodeCursor(encodeCursor(cursor), 'relevance')).toEqual(cursor);
  });

  it('round-trips a date cursor', () => {
    const cursor = {
      sort: 'date' as const,
      rank: null,
      publishedAt: '2026-01-15T10:00:00.000Z',
      id: 'job-2',
    };
    expect(decodeCursor(encodeCursor(cursor), 'date')).toEqual(cursor);
  });

  it('rejects garbage', () => {
    expect(() => decodeCursor('not-a-cursor', 'date')).toThrow(AppException);
    expect(() => decodeCursor('', 'date')).toThrow(AppException);
  });

  it('rejects a cursor made for another sort', () => {
    const token = encodeCursor({
      sort: 'date',
      rank: null,
      publishedAt: '2026-01-15T10:00:00.000Z',
      id: 'job-2',
    });
    expect(() => decodeCursor(token, 'relevance')).toThrow(AppException);
  });

  it('rejects a relevance cursor without a rank', () => {
    const token = Buffer.from(
      JSON.stringify({
        s: 'relevance',
        r: null,
        p: '2026-01-15T10:00:00.000Z',
        i: 'x',
      }),
    ).toString('base64url');
    expect(() => decodeCursor(token, 'relevance')).toThrow(AppException);
  });

  it('rejects an invalid date inside the cursor', () => {
    const token = Buffer.from(
      JSON.stringify({ s: 'date', r: null, p: 'yesterday', i: 'x' }),
    ).toString('base64url');
    expect(() => decodeCursor(token, 'date')).toThrow(AppException);
  });
});

describe('makeExcerpt', () => {
  it('collapses whitespace and keeps short text', () => {
    expect(makeExcerpt('  hello \n  world ')).toBe('hello world');
  });

  it('truncates long text with an ellipsis', () => {
    const excerpt = makeExcerpt('word '.repeat(200));
    expect(excerpt.length).toBeLessThanOrEqual(240);
    expect(excerpt.endsWith('...')).toBe(true);
  });
});
