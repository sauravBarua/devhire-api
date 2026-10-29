import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DomainEvents,
  type JobEventName,
  type JobEventPayload,
} from '../../common/events/domain-events';
import { AppException } from '../../common/errors/app.exception';
import { ENV, type Env } from '../../config/env';
import type { Prisma } from '../../generated/prisma/client';
import { JobStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  CompaniesService,
  type CompanyView,
} from '../companies/companies.service';
import { SkillsService } from '../skills/skills.service';
import type {
  CreateJobDto,
  ListJobsQueryDto,
  UpdateJobDto,
} from './dto/job.dto';
import { applyTransition, type JobAction } from './job-lifecycle';
import { toJobView, type JobView } from './jobs.view';

export interface JobPage {
  items: JobView[];
  nextCursor: string | null;
}

const JOB_INCLUDE = {
  skills: { select: { skillId: true } },
} as const satisfies Prisma.JobInclude;
type JobRow = Prisma.JobGetPayload<{ include: typeof JOB_INCLUDE }>;

const EVENT_BY_ACTION: Record<JobAction, JobEventName> = {
  publish: DomainEvents.JobPublished,
  close: DomainEvents.JobClosed,
  expire: DomainEvents.JobExpired,
  renew: DomainEvents.JobRenewed,
};

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly skills: SkillsService,
    private readonly events: EventEmitter2,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(userId: string, dto: CreateJobDto): Promise<JobView> {
    const companyId = await this.requireCompanyId(userId);
    const skillIds = await this.resolveSkillIds(dto.skills);
    const row = await this.prisma.job.create({
      data: {
        companyId,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        contractType: dto.contractType,
        remotePolicy: dto.remotePolicy,
        experienceLevel: dto.experienceLevel,
        city: dto.city,
        region: dto.region,
        salaryMin: dto.salaryMin,
        salaryMax: dto.salaryMax,
        skills: { create: skillIds.map((skillId) => ({ skillId })) },
      },
      include: JOB_INCLUDE,
    });
    return this.viewOne(row);
  }

  async list(userId: string, query: ListJobsQueryDto): Promise<JobPage> {
    const companyId = await this.requireCompanyId(userId);
    const rows = await this.prisma.job.findMany({
      where: { companyId, status: query.status },
      include: JOB_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: await this.toViews(page),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async get(userId: string, jobId: string): Promise<JobView> {
    const companyId = await this.requireCompanyId(userId);
    return this.viewOne(await this.requireOwnedJob(companyId, jobId));
  }

  // public entry point for other modules (applications): does this recruiter own the job?
  async ownsJob(userId: string, jobId: string): Promise<boolean> {
    const company = await this.companies.findByOwnerId(userId);
    if (!company) return false;
    const count = await this.prisma.job.count({
      where: { id: jobId, companyId: company.id },
    });
    return count > 0;
  }

  async update(
    userId: string,
    jobId: string,
    dto: UpdateJobDto,
  ): Promise<JobView> {
    const companyId = await this.requireCompanyId(userId);
    const job = await this.requireOwnedJob(companyId, jobId);

    // the schema only compares fields sent together, so check against stored values too
    const salaryMin =
      dto.salaryMin !== undefined ? dto.salaryMin : job.salaryMin;
    const salaryMax =
      dto.salaryMax !== undefined ? dto.salaryMax : job.salaryMax;
    if (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'salaryMin must be less than or equal to salaryMax',
      );
    }

    const skillIds = dto.skills
      ? await this.resolveSkillIds(dto.skills)
      : undefined;
    const row = await this.prisma.job.update({
      where: { id: job.id },
      data: {
        title: dto.title,
        description: dto.description,
        category: dto.category,
        contractType: dto.contractType,
        remotePolicy: dto.remotePolicy,
        experienceLevel: dto.experienceLevel,
        city: dto.city,
        region: dto.region,
        salaryMin: dto.salaryMin,
        salaryMax: dto.salaryMax,
        skills: skillIds
          ? { deleteMany: {}, create: skillIds.map((skillId) => ({ skillId })) }
          : undefined,
      },
      include: JOB_INCLUDE,
    });
    return this.viewOne(row);
  }

  async remove(userId: string, jobId: string): Promise<void> {
    const companyId = await this.requireCompanyId(userId);
    const job = await this.requireOwnedJob(companyId, jobId);
    const notAllowed = new AppException(
      HttpStatus.CONFLICT,
      'JOB_DELETE_NOT_ALLOWED',
      'Only draft jobs can be deleted; close the job instead',
      { status: job.status },
    );
    if (job.status !== JobStatus.DRAFT) throw notAllowed;
    const result = await this.prisma.job.deleteMany({
      where: { id: job.id, status: JobStatus.DRAFT },
    });
    if (result.count === 0) throw notAllowed;
  }

  publish(userId: string, jobId: string): Promise<JobView> {
    return this.transition(userId, jobId, 'publish');
  }

  close(userId: string, jobId: string): Promise<JobView> {
    return this.transition(userId, jobId, 'close');
  }

  renew(userId: string, jobId: string): Promise<JobView> {
    return this.transition(userId, jobId, 'renew');
  }

  private async transition(
    userId: string,
    jobId: string,
    action: JobAction,
  ): Promise<JobView> {
    const company = await this.requireCompany(userId);
    const job = await this.requireOwnedJob(company.id, jobId);

    // a hidden company must not put jobs back online
    if ((action === 'publish' || action === 'renew') && company.isHidden) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        'COMPANY_HIDDEN',
        'Your company is hidden by a moderator; jobs cannot be published or renewed',
      );
    }
    // a job closed by a moderator stays closed
    if (action === 'renew' && job.moderatedAt !== null) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'JOB_MODERATED',
        'This job was closed by a moderator and cannot be renewed',
      );
    }

    const now = new Date();
    const next = applyTransition(
      job,
      action,
      now,
      this.env.JOB_DEFAULT_EXPIRY_DAYS,
    );

    // conditional update: if the status changed since we read it, nothing is written
    const startsNewPeriod = action === 'publish' || action === 'renew';
    const result = await this.prisma.job.updateMany({
      where: { id: job.id, status: job.status },
      data: startsNewPeriod ? { ...next, expiryReminderSentAt: null } : next,
    });
    if (result.count === 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'JOB_INVALID_TRANSITION',
        'Job status changed in the meantime, please reload',
        { from: job.status, action },
      );
    }

    const payload: JobEventPayload = {
      jobId: job.id,
      companyId: company.id,
      occurredAt: now,
    };
    this.events.emit(EVENT_BY_ACTION[action], payload);

    return this.viewOne(await this.requireOwnedJob(company.id, jobId));
  }

  private async requireCompany(userId: string): Promise<CompanyView> {
    const company = await this.companies.findByOwnerId(userId);
    if (!company) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'COMPANY_REQUIRED',
        'Create your company profile before managing jobs',
      );
    }
    return company;
  }

  private async requireCompanyId(userId: string): Promise<string> {
    return (await this.requireCompany(userId)).id;
  }

  // a job of another company is reported as not found, so its existence is not revealed
  private async requireOwnedJob(
    companyId: string,
    jobId: string,
  ): Promise<JobRow> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, companyId },
      include: JOB_INCLUDE,
    });
    if (!job)
      throw new AppException(
        HttpStatus.NOT_FOUND,
        'JOB_NOT_FOUND',
        'Job not found',
      );
    return job;
  }

  private async resolveSkillIds(slugs: string[]): Promise<string[]> {
    const unique = [...new Set(slugs)];
    if (unique.length === 0) return [];
    const found = await this.skills.findBySlugs(unique);
    const known = new Set(found.map((skill) => skill.slug));
    const unknown = unique.filter((slug) => !known.has(slug));
    if (unknown.length > 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'SKILL_NOT_FOUND',
        'Unknown skills',
        {
          unknown,
        },
      );
    }
    return found.map((skill) => skill.id);
  }

  private async viewOne(row: JobRow): Promise<JobView> {
    const [view] = await this.toViews([row]);
    return view;
  }

  private async toViews(rows: JobRow[]): Promise<JobView[]> {
    const ids = [
      ...new Set(
        rows.flatMap((row) => row.skills.map((skill) => skill.skillId)),
      ),
    ];
    const skills = ids.length > 0 ? await this.skills.findByIds(ids) : [];
    const byId = new Map(skills.map((skill) => [skill.id, skill]));
    const now = new Date();
    return rows.map((row) =>
      toJobView(
        row,
        row.skills
          .flatMap(({ skillId }) => {
            const skill = byId.get(skillId);
            return skill ? [{ slug: skill.slug, name: skill.name }] : [];
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
        now,
      ),
    );
  }
}
