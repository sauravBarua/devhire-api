import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { redisConnectionFromUrl } from './redis-connection';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        connection: redisConnectionFromUrl(env.REDIS_URL),
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
