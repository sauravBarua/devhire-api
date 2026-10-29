import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { AuthModule } from '../auth/auth.module';
import { CompaniesModule } from '../companies/companies.module';
import { JobsModule } from '../jobs/jobs.module';
import { SavedModule } from '../saved/saved.module';
import { SearchModule } from '../search/search.module';
import { AlertsService } from './alerts.service';
import { NotificationEventsListener } from './notification-events.listener';
import { NOTIFICATIONS_QUEUE } from './notifications.types';
import { NotificationsProcessor } from './notifications.processor';

@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: NOTIFICATIONS_QUEUE,
      inject: [ENV],
      useFactory: (env: Env) => ({
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: env.QUEUE_BACKOFF_MS },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      }),
    }),
    SavedModule,
    SearchModule,
    JobsModule,
    CompaniesModule,
    AuthModule,
  ],
  providers: [
    AlertsService,
    NotificationEventsListener,
    NotificationsProcessor,
  ],
  exports: [AlertsService],
})
export class AlertsModule {}
