import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppException } from '../../common/errors/app.exception';
import {
  DomainEvents,
  type JobEventPayload,
} from '../../common/events/domain-events';
import type { CursorPage } from '../../common/types/cursor-page';
import { ENV, type Env } from '../../config/env';
import type { Job } from '../../generated/prisma/client';
import { JobStatus, type JobCategory } from '../../generated/prisma/enums';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  CompaniesService,
  type CompanySummary,
} from '../companies/companies.service';
import { applyTransition } from './job-lifecycle';

export interface AdminJobView {
  id: string;
  title: string;
  status: JobStatus;
  category: JobCategory;
  city: string | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  closedAt: Date | null;
  moderatedAt: Date | null;
  moderationReason: string | null;
  company: CompanySummary | null;
}

export interface AdminJobsQuery {
  status?: JobStatus;
  companyId?: string;
  limit: number;
  cursor?: string;
}

function toAdminView(
  job: Job,
  company: CompanySummary | undefined,
): AdminJobView {
  return {
    id: job.id,
    title: job.title,
    status: job.status,
    category: job.category,
    city: job.city,
    publishedAt: job.publishedAt,
    expiresAt: job.expiresAt,
    closedAt: job.closedAt,
    moderatedAt: job.moderatedAt,
    moderationReason: job.moderationReason,
    company: company ?? null,
  };
}

@Injectable()
export class JobModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly events: EventEmitter2,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // drafts are private to their recruiter, so they are only listed when asked for explicitly
  async list(query: AdminJobsQuery): Promise<CursorPage<AdminJobView>> {
    const rows = await this.prisma.job.findMany({
      where: {
        status: query.status ?? { not: JobStatus.DRAFT },
        companyId: query.companyId,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    const companies = await this.companies.findSummariesByIds([
      ...new Set(page.map((row) => row.companyId)),
    ]);
    const byId = new Map(companies.map((company) => [company.id, company]));
    return {
      items: page.map((row) => toAdminView(row, byId.get(row.companyId))),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // Closes a PUBLISHED job on behalf of a moderator. It goes through the same state machine as a
  // recruiter closing it; moderatedAt is what stops the owner from renewing it afterwards.
  async forceClose(jobId: string, reason: string): Promise<AdminJobView> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job)
      throw new AppException(
        HttpStatus.NOT_FOUND,
        'JOB_NOT_FOUND',
        'Job not found',
      );

    const now = new Date();
    const next = applyTransition(
      job,
      'close',
      now,
      this.env.JOB_DEFAULT_EXPIRY_DAYS,
    );
    const result = await this.prisma.job.updateMany({
      where: { id: job.id, status: job.status },
      data: { ...next, moderatedAt: now, moderationReason: reason },
    });
    if (result.count === 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'JOB_INVALID_TRANSITION',
        'Job status changed in the meantime, please reload',
        { from: job.status, action: 'close' },
      );
    }

    const payload: JobEventPayload = {
      jobId: job.id,
      companyId: job.companyId,
      occurredAt: now,
    };
    this.events.emit(DomainEvents.JobClosed, payload);

    const updated = await this.prisma.job.findUniqueOrThrow({
      where: { id: job.id },
    });
    const [company] = await this.companies.findSummariesByIds([
      updated.companyId,
    ]);
    return toAdminView(updated, company);
  }
}
