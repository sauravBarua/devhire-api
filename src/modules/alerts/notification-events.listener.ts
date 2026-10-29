import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
import {
  DomainEvents,
  type ApplicationCreatedPayload,
  type JobExpiringPayload,
} from '../../common/events/domain-events';
import {
  NOTIFICATIONS_QUEUE,
  NotificationJobs,
  type ExpiryReminderData,
  type NewApplicationData,
} from './notifications.types';

// BullMQ job ids must not contain ":"; the fixed ids make duplicate events harmless
@Injectable()
export class NotificationEventsListener {
  private readonly logger = new Logger(NotificationEventsListener.name);

  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  @OnEvent(DomainEvents.JobExpiringSoon)
  async onJobExpiringSoon(payload: JobExpiringPayload): Promise<void> {
    const data: ExpiryReminderData = { jobId: payload.jobId };
    await this.enqueue(
      NotificationJobs.ExpiryReminder,
      data,
      `expiry-${payload.jobId}-${payload.expiresAt.getTime()}`,
    );
  }

  @OnEvent(DomainEvents.ApplicationCreated)
  async onApplicationCreated(
    payload: ApplicationCreatedPayload,
  ): Promise<void> {
    const data: NewApplicationData = {
      applicationId: payload.applicationId,
      jobId: payload.jobId,
      companyId: payload.companyId,
      candidateId: payload.candidateId,
    };
    await this.enqueue(
      NotificationJobs.NewApplication,
      data,
      `application-${payload.applicationId}`,
    );
  }

  private async enqueue(
    name: string,
    data: object,
    jobId: string,
  ): Promise<void> {
    try {
      await this.queue.add(name, data, { jobId });
    } catch (error) {
      this.logger.error(
        `Could not queue ${name}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}
