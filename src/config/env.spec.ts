import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  REDIS_URL: 'redis://localhost:6379',
};

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.JOB_DEFAULT_EXPIRY_DAYS).toBe(30);
  });

  it('coerces JOB_DEFAULT_EXPIRY_DAYS to a number', () => {
    expect(
      parseEnv({ ...base, JOB_DEFAULT_EXPIRY_DAYS: '14' })
        .JOB_DEFAULT_EXPIRY_DAYS,
    ).toBe(14);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => parseEnv({ REDIS_URL: base.REDIS_URL })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects a non-positive expiry', () => {
    expect(() => parseEnv({ ...base, JOB_DEFAULT_EXPIRY_DAYS: '0' })).toThrow();
  });
});
