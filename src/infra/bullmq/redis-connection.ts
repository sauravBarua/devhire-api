export interface RedisConnectionConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
}

// BullMQ wants connection options, not a URL string. A plain object is used on purpose:
// BullMQ ships its own ioredis types, so an ioredis type imported here would not match.
export function redisConnectionFromUrl(url: string): RedisConnectionConfig {
  const parsed = new URL(url);
  const db =
    parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : undefined;
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: db !== undefined && Number.isInteger(db) ? db : undefined,
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
