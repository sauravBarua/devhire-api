import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import {
  DomainEvents,
  type JobEventPayload,
} from '../../common/events/domain-events';
import { AlertFrequency } from '../../generated/prisma/enums';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SavedSearchesService } from '../saved/saved-searches.service';
import { SearchService } from '../search/search.service';
import {
  NOTIFICATIONS_QUEUE,
  NotificationJobs,
  type SearchAlertData,
} from './notifications.types';

const BATCH_SIZE = 200;

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly savedSearches: SavedSearchesService,
    private readonly search: SearchService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  @OnEvent(DomainEvents.JobPublished)
  async onJobPublished(payload: JobEventPayload): Promise<void> {
    try {
      await this.matchJob(payload.jobId);
    } catch (error) {
      this.logger.error(
        `Alert matching failed for job ${payload.jobId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  // Records a match for every enabled saved search the job fits. The unique (savedSearchId, jobId)
  // key makes this idempotent, so a job is never queued twice for the same search.
  async matchJob(jobId: string): Promise<number> {
    let created = 0;
    let after: string | null = null;
    for (;;) {
      const batch = await this.savedSearches.listAlertable(after, BATCH_SIZE);
      if (batch.length === 0) break;

      for (const savedSearch of batch) {
        if (!(await this.search.matchesJob(savedSearch.filters, jobId)))
          continue;
        const result = await this.prisma.alertMatch.createMany({
          data: [{ savedSearchId: savedSearch.id, jobId }],
          skipDuplicates: true,
        });
        if (result.count !== 1) continue;
        created += 1;
        if (savedSearch.frequency === AlertFrequency.INSTANT) {
          await this.queueSearchAlert(savedSearch.id);
        }
      }
      after = batch[batch.length - 1].id;
      if (batch.length < BATCH_SIZE) break;
    }
    return created;
  }

  // Every day at 08:00 (Paris): queue one email per saved search that still has unsent matches.
  // It also catches up INSTANT searches whose email could not be queued earlier.
  @Cron('0 8 * * *', { name: 'daily-digest', timeZone: 'Europe/Paris' })
  async runDailyDigest(): Promise<void> {
    try {
      await this.enqueueDailyDigests();
    } catch (error) {
      this.logger.error(
        `Daily digest failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  async enqueueDailyDigests(): Promise<number> {
    const pending = await this.prisma.alertMatch.groupBy({
      by: ['savedSearchId'],
      where: { notifiedAt: null },
    });
    const day = new Date().toISOString().slice(0, 10);
    for (const { savedSearchId } of pending) {
      const data: SearchAlertData = { savedSearchId };
      await this.queue.add(NotificationJobs.SearchAlert, data, {
        jobId: `digest-${savedSearchId}-${day}`,
      });
    }
    return pending.length;
  }

  private async queueSearchAlert(savedSearchId: string): Promise<void> {
    try {
      const data: SearchAlertData = { savedSearchId };
      await this.queue.add(NotificationJobs.SearchAlert, data);
    } catch (error) {
      // the match is stored, so the daily digest will still send it
      this.logger.warn(
        `Could not queue alert for saved search ${savedSearchId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}
