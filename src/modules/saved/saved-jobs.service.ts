import { Injectable } from '@nestjs/common';
import type {
  ContractType,
  ExperienceLevel,
  JobStatus,
  RemotePolicy,
} from '../../generated/prisma/enums';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { PublicJobView } from '../jobs/jobs.view';
import { PublicJobsService } from '../jobs/public-jobs.service';
import type { SavedListQueryDto } from './dto/saved.dto';

export interface SavedJobView {
  id: string;
  jobId: string;
  savedAt: Date;
}

export interface SavedJobSummary {
  id: string;
  title: string;
  city: string | null;
  contractType: ContractType;
  remotePolicy: RemotePolicy;
  experienceLevel: ExperienceLevel;
  status: JobStatus;
  // false once the job is closed, expired or past its expiry date ("Offre clôturée")
  isOpen: boolean;
  publishedAt: Date | null;
  expiresAt: Date | null;
  closedAt: Date | null;
  postedDaysAgo: number | null;
  company: { id: string; slug: string; name: string; logoUrl: string | null };
}

export interface SavedJobItem extends SavedJobView {
  job: SavedJobSummary | null;
}

export interface SavedPage<T> {
  items: T[];
  nextCursor: string | null;
}

function toSummary(job: PublicJobView): SavedJobSummary {
  return {
    id: job.id,
    title: job.title,
    city: job.city,
    contractType: job.contractType,
    remotePolicy: job.remotePolicy,
    experienceLevel: job.experienceLevel,
    status: job.status,
    isOpen: job.isOpen,
    publishedAt: job.publishedAt,
    expiresAt: job.expiresAt,
    closedAt: job.closedAt,
    postedDaysAgo: job.postedDaysAgo,
    company: {
      id: job.company.id,
      slug: job.company.slug,
      name: job.company.name,
      logoUrl: job.company.logoUrl,
    },
  };
}

@Injectable()
export class SavedJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publicJobs: PublicJobsService,
  ) {}

  // idempotent: saving twice returns the same record
  async save(userId: string, jobId: string): Promise<SavedJobView> {
    // 404 for drafts and unknown ids; closed and expired jobs can still be saved
    const job = await this.publicJobs.getPublic(jobId);
    const row = await this.prisma.savedJob.upsert({
      where: { userId_jobId: { userId, jobId: job.id } },
      update: {},
      create: { userId, jobId: job.id },
    });
    return { id: row.id, jobId: row.jobId, savedAt: row.createdAt };
  }

  // idempotent: unsaving something that is not saved is a no-op
  async unsave(userId: string, jobId: string): Promise<void> {
    await this.prisma.savedJob.deleteMany({ where: { userId, jobId } });
  }

  async list(
    userId: string,
    query: SavedListQueryDto,
  ): Promise<SavedPage<SavedJobItem>> {
    const rows = await this.prisma.savedJob.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    const views = await this.publicJobs.findPublicByIds([
      ...new Set(page.map((row) => row.jobId)),
    ]);
    const byId = new Map(views.map((view) => [view.id, view]));

    return {
      items: page.map((row) => {
        const view = byId.get(row.jobId);
        return {
          id: row.id,
          jobId: row.jobId,
          savedAt: row.createdAt,
          job: view ? toSummary(view) : null,
        };
      }),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }
}
