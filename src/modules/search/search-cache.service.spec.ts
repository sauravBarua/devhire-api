import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RedisService } from '../../infra/redis/redis.service';
import { SearchCacheService } from './search-cache.service';
import type { SearchResult } from './search.service';

const result: SearchResult = {
  items: [],
  nextCursor: null,
  total: 0,
  facets: null,
};
const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

function build() {
  const store = new Map<string, string>();
  const client = {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    incr: vi.fn((key: string) => {
      const next = Number(store.get(key) ?? '0') + 1;
      store.set(key, String(next));
      return Promise.resolve(next);
    }),
  };
  return {
    client,
    cache: new SearchCacheService({ client } as unknown as RedisService),
  };
}

beforeAll(() => {
  Logger.overrideLogger(false);
});

describe('SearchCacheService', () => {
  it('misses, stores with a 60 s TTL, then hits', async () => {
    const { client, cache } = build();
    const first = await cache.lookup({ q: 'node' });
    expect(first.hit).toBeNull();

    await first.store(result);
    expect(client.set).toHaveBeenCalledWith(
      expect.stringMatching(/^search:0:[0-9a-f]{40}$/),
      JSON.stringify(result),
      'EX',
      60,
    );

    const second = await cache.lookup({ q: 'node' });
    expect(second.hit).toEqual(result);
  });

  it('keeps different searches apart', async () => {
    const { cache } = build();
    await (await cache.lookup({ q: 'node' })).store(result);
    expect((await cache.lookup({ q: 'react' })).hit).toBeNull();
  });

  it('forgets everything at once when the version is bumped', async () => {
    const { client, cache } = build();
    await (await cache.lookup({ q: 'node' })).store(result);

    cache.invalidate();
    expect(client.incr).toHaveBeenCalledWith('search:version');

    const after = await cache.lookup({ q: 'node' });
    expect(after.hit).toBeNull();
    await after.store(result);
    expect(client.set).toHaveBeenLastCalledWith(
      expect.stringMatching(/^search:1:/),
      expect.any(String),
      'EX',
      60,
    );
  });

  it('never breaks a search when Redis fails to read', async () => {
    const { client, cache } = build();
    client.get.mockRejectedValue(new Error('redis down'));
    const slot = await cache.lookup({ q: 'node' });
    expect(slot.hit).toBeNull();
    await expect(slot.store(result)).resolves.toBeUndefined();
    expect(client.set).not.toHaveBeenCalled();
  });

  it('never breaks a search when Redis fails to write', async () => {
    const { client, cache } = build();
    client.set.mockRejectedValue(new Error('redis down'));
    const slot = await cache.lookup({ q: 'node' });
    await expect(slot.store(result)).resolves.toBeUndefined();
  });

  it('swallows an invalidation failure', async () => {
    const { client, cache } = build();
    client.incr.mockRejectedValue(new Error('redis down'));
    expect(() => cache.invalidate()).not.toThrow();
    await tick();
  });
});
