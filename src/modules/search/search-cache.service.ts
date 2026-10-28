import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvents } from '../../common/events/domain-events';
import { RedisService } from '../../infra/redis/redis.service';
import type { SearchResult } from './search.service';

const VERSION_KEY = 'search:version';
const TTL_SECONDS = 60;

export interface CacheSlot {
  hit: SearchResult | null;
  store: (result: SearchResult) => Promise<void>;
}

// Cache keys contain a version number. Any job status event bumps the version, so every
// older entry is orphaned at once and simply expires by TTL. Redis failures never break search.
@Injectable()
export class SearchCacheService {
  private readonly logger = new Logger(SearchCacheService.name);

  constructor(private readonly redis: RedisService) {}

  async lookup(params: object): Promise<CacheSlot> {
    const miss: CacheSlot = { hit: null, store: () => Promise.resolve() };
    try {
      const version = (await this.redis.client.get(VERSION_KEY)) ?? '0';
      const digest = createHash('sha1')
        .update(JSON.stringify(params))
        .digest('hex');
      const key = `search:${version}:${digest}`;

      const cached = await this.redis.client.get(key);
      if (cached)
        return { hit: JSON.parse(cached) as SearchResult, store: miss.store };

      return {
        hit: null,
        store: async (result) => {
          try {
            await this.redis.client.set(
              key,
              JSON.stringify(result),
              'EX',
              TTL_SECONDS,
            );
          } catch (error) {
            this.warn('store', error);
          }
        },
      };
    } catch (error) {
      this.warn('lookup', error);
      return miss;
    }
  }

  @OnEvent(DomainEvents.JobPublished)
  @OnEvent(DomainEvents.JobClosed)
  @OnEvent(DomainEvents.JobExpired)
  @OnEvent(DomainEvents.JobRenewed)
  invalidate(): void {
    // issued synchronously, so a search started after the transition always sees the new version
    this.redis.client
      .incr(VERSION_KEY)
      .catch((error: unknown) => this.warn('invalidate', error));
  }

  private warn(action: string, error: unknown): void {
    this.logger.warn(
      `Search cache ${action} failed: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }
}
