import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  DomainEvents,
  type JobEventPayload,
  type JobExpiringPayload,
} from '../../common/events/domain-events';
import { ENV, type Env } from '../../config/env';
import { JobStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { applyTransition } from './job-lifecycle';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 200;
const MAX_BATCHES = 50;

// Safe to run on several instances at once: every write is a conditional update, so each job is
// expired (and each reminder flagged) exactly once and its event is emitted exactly once.
@Injectable()
export class JobExpiryService {
  private readonly logger = new Logger(JobExpiryService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'job-expiry' })
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const expired = await this.expireDueJobs();
      const reminded = await this.flagExpiringSoon();
      if (expired + reminded > 0) {
        this.logger.log(
          `Expired ${expired} job(s), flagged ${reminded} expiry reminder(s)`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Job expiry run failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    } finally {
      this.running = false;
    }
  }

  // PUBLISHED -> EXPIRED for every job whose expiresAt is in the past
  async expireDueJobs(now: Date = new Date()): Promise<number> {
    let total = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const due = await this.prisma.job.findMany({
        where: { status: JobStatus.PUBLISHED, expiresAt: { lte: now } },
        orderBy: { expiresAt: 'asc' },
        take: BATCH_SIZE,
      });
      if (due.length === 0) break;

      for (const job of due) {
        const next = applyTransition(
          job,
          'expire',
          now,
          this.env.JOB_DEFAULT_EXPIRY_DAYS,
        );
        const result = await this.prisma.job.updateMany({
          where: {
            id: job.id,
            status: JobStatus.PUBLISHED,
            expiresAt: { lte: now },
          },
          data: next,
        });
        if (result.count === 1) {
          total += 1;
          const payload: JobEventPayload = {
            jobId: job.id,
            companyId: job.companyId,
            occurredAt: now,
          };
          this.events.emit(DomainEvents.JobExpired, payload);
        }
      }
      if (due.length < BATCH_SIZE) break;
    }
    return total;
  }

  // flags each job once per publication period; the reminder email is queued from the event
  async flagExpiringSoon(now: Date = new Date()): Promise<number> {
    const horizon = new Date(
      now.getTime() + this.env.JOB_EXPIRY_REMINDER_DAYS * DAY_MS,
    );
    const candidates = await this.prisma.job.findMany({
      where: {
        status: JobStatus.PUBLISHED,
        expiresAt: { gt: now, lte: horizon },
        expiryReminderSentAt: null,
      },
      select: { id: true, companyId: true, expiresAt: true },
      take: BATCH_SIZE,
    });

    let total = 0;
    for (const job of candidates) {
      if (!job.expiresAt) continue;
      const result = await this.prisma.job.updateMany({
        where: {
          id: job.id,
          status: JobStatus.PUBLISHED,
          expiryReminderSentAt: null,
        },
        data: { expiryReminderSentAt: now },
      });
      if (result.count === 1) {
        total += 1;
        const payload: JobExpiringPayload = {
          jobId: job.id,
          companyId: job.companyId,
          expiresAt: job.expiresAt,
          occurredAt: now,
        };
        this.events.emit(DomainEvents.JobExpiringSoon, payload);
      }
    }
    return total;
  }
}
