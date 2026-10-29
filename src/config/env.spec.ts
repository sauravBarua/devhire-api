import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.JOB_DEFAULT_EXPIRY_DAYS).toBe(30);
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
  });

  it('defaults the mail settings to the MailHog container', () => {
    const env = parseEnv(base);
    expect(env.SMTP_HOST).toBe('localhost');
    expect(env.SMTP_PORT).toBe(1025);
    expect(env.SMTP_SECURE).toBe(false);
    expect(env.WEB_URL).toBe('http://localhost:3001');
    expect(env.JOB_EXPIRY_REMINDER_DAYS).toBe(3);
    expect(env.QUEUE_BACKOFF_MS).toBe(5000);
  });

  it('parses SMTP_SECURE as a boolean', () => {
    expect(parseEnv({ ...base, SMTP_SECURE: 'true' }).SMTP_SECURE).toBe(true);
    expect(parseEnv({ ...base, SMTP_SECURE: 'false' }).SMTP_SECURE).toBe(false);
  });

  it('coerces JOB_DEFAULT_EXPIRY_DAYS to a number', () => {
    expect(
      parseEnv({ ...base, JOB_DEFAULT_EXPIRY_DAYS: '14' })
        .JOB_DEFAULT_EXPIRY_DAYS,
    ).toBe(14);
  });

  it('throws when DATABASE_URL is missing', () => {
    const rest: NodeJS.ProcessEnv = { ...base };
    delete rest.DATABASE_URL;
    expect(() => parseEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-positive expiry', () => {
    expect(() => parseEnv({ ...base, JOB_DEFAULT_EXPIRY_DAYS: '0' })).toThrow();
  });

  it('rejects a short JWT secret', () => {
    expect(() => parseEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('treats blank optional values as unset', () => {
    const env = parseEnv({ ...base, CLOUDINARY_CLOUD_NAME: '', SMTP_USER: '' });
    expect(env.CLOUDINARY_CLOUD_NAME).toBeUndefined();
    expect(env.SMTP_USER).toBeUndefined();
  });

  it('keeps Cloudinary values when set', () => {
    expect(
      parseEnv({ ...base, CLOUDINARY_CLOUD_NAME: 'demo' })
        .CLOUDINARY_CLOUD_NAME,
    ).toBe('demo');
  });

  it('rejects an invalid WEB_URL', () => {
    expect(() => parseEnv({ ...base, WEB_URL: 'not a url' })).toThrow(
      /WEB_URL/,
    );
  });
});
