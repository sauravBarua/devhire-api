import 'dotenv/config';
import { z } from 'zod';

export const ENV = Symbol('ENV');

// blank values in .env ("KEY=") count as unset
const blankToUndefined = (value: unknown): unknown =>
  value === '' ? undefined : value;
const optionalString = z.preprocess(
  blankToUndefined,
  z.string().min(1).optional(),
);

// "a,b" -> ["https://a", "https://b"]; only http(s) origins are valid ("*" and "localhost:3001" are not)
const corsOrigins = z
  .string()
  .default('http://localhost:3001')
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  )
  .pipe(z.array(z.url({ protocol: /^https?$/ })).min(1))
  .transform((list) => [
    ...new Set(list.map((entry) => new URL(entry).origin)),
  ]);

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  JOB_DEFAULT_EXPIRY_DAYS: z.coerce.number().int().positive().default(30),
  JOB_EXPIRY_REMINDER_DAYS: z.coerce.number().int().min(1).max(30).default(3),
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  CLOUDINARY_CLOUD_NAME: optionalString,
  CLOUDINARY_API_KEY: optionalString,
  CLOUDINARY_API_SECRET: optionalString,
  SMTP_HOST: z.string().min(1).default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: z.stringbool().default(false),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  MAIL_FROM: z.string().min(3).default('DevHire <no-reply@devhire.test>'),
  WEB_URL: z.url().default('http://localhost:3001'),
  QUEUE_BACKOFF_MS: z.coerce.number().int().min(10).default(5000),
  CORS_ORIGINS: corsOrigins,
  // number of reverse proxies in front of the API (Nginx = 1); 0 trusts nobody
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  THROTTLE_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
  THROTTLE_LIMIT: z.coerce.number().int().min(1).default(100),
  THROTTLE_STRICT_LIMIT: z.coerce.number().int().min(1).default(10),
  SENTRY_DSN: z.preprocess(blankToUndefined, z.url().optional()),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15000),
  SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(0).max(60000).default(0),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
