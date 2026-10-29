import { describe, expect, it } from 'vitest';
import { redisConnectionFromUrl } from './redis-connection';

describe('redisConnectionFromUrl', () => {
  it('parses host and port', () => {
    expect(redisConnectionFromUrl('redis://localhost:6380')).toMatchObject({
      host: 'localhost',
      port: 6380,
    });
  });

  it('defaults the port to 6379', () => {
    expect(redisConnectionFromUrl('redis://cache.internal').port).toBe(6379);
  });

  it('parses credentials and database', () => {
    expect(
      redisConnectionFromUrl('redis://user:p%40ss@host:6379/2'),
    ).toMatchObject({
      username: 'user',
      password: 'p@ss',
      db: 2,
    });
  });

  it('enables TLS for rediss://', () => {
    expect(redisConnectionFromUrl('rediss://host:6380')).toHaveProperty('tls');
    expect(redisConnectionFromUrl('redis://host:6379')).not.toHaveProperty(
      'tls',
    );
  });
});
