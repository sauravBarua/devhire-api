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
    const env = parseEnv({
      ...base,
      CLOUDINARY_CLOUD_NAME: '',
      SMTP_USER: '',
      SENTRY_DSN: '',
    });
    expect(env.CLOUDINARY_CLOUD_NAME).toBeUndefined();
    expect(env.SMTP_USER).toBeUndefined();
    expect(env.SENTRY_DSN).toBeUndefined();
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

  it('defaults the security settings', () => {
    const env = parseEnv(base);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3001']);
    expect(env.TRUST_PROXY).toBe(0);
    expect(env.THROTTLE_TTL_SECONDS).toBe(60);
    expect(env.THROTTLE_LIMIT).toBe(100);
    expect(env.THROTTLE_STRICT_LIMIT).toBe(10);
    expect(env.SHUTDOWN_TIMEOUT_MS).toBe(15000);
    expect(env.SHUTDOWN_DRAIN_MS).toBe(0);
  });

  it('parses CORS_ORIGINS into a list of normalized origins', () => {
    const env = parseEnv({
      ...base,
      CORS_ORIGINS:
        'http://localhost:3001, https://app.example.com/ ,http://localhost:3001',
    });
    expect(env.CORS_ORIGINS).toEqual([
      'http://localhost:3001',
      'https://app.example.com',
    ]);
  });

  it('rejects a wildcard or malformed CORS origin', () => {
    expect(() => parseEnv({ ...base, CORS_ORIGINS: '*' })).toThrow(
      /CORS_ORIGINS/,
    );
    expect(() => parseEnv({ ...base, CORS_ORIGINS: 'localhost:3001' })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it('rejects an invalid SENTRY_DSN', () => {
    expect(() => parseEnv({ ...base, SENTRY_DSN: 'not-a-dsn' })).toThrow(
      /SENTRY_DSN/,
    );
  });

  it('rejects a shutdown timeout under one second', () => {
    expect(() => parseEnv({ ...base, SHUTDOWN_TIMEOUT_MS: '10' })).toThrow(
      /SHUTDOWN_TIMEOUT_MS/,
    );
  });
});
