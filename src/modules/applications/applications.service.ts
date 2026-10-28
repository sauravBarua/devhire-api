import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppException } from '../../common/errors/app.exception';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import {
  DomainEvents,
  type ApplicationCreatedPayload,
  type ApplicationStatusChangedPayload,
} from '../../common/events/domain-events';
import { resolvePdfMime } from '../../common/files/pdf-signature';
import type { Application } from '../../generated/prisma/client';
import type {
  ApplicationStatus,
  JobStatus,
} from '../../generated/prisma/enums';
import { CloudinaryService } from '../../infra/cloudinary/cloudinary.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { JobsService } from '../jobs/jobs.service';
import { PublicJobsService } from '../jobs/public-jobs.service';
import { assertTransition } from './application-lifecycle';
import type { ApplyDto, ListApplicationsQueryDto } from './dto/application.dto';

const CV_FOLDER = 'devhire/cvs';

export interface ApplicationView {
  id: string;
  jobId: string;
  status: ApplicationStatus;
  coverLetter: string | null;
  cvUrl: string;
  cvSize: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CandidateApplicationView extends ApplicationView {
  job: {
    id: string;
    title: string;
    city: string | null;
    status: JobStatus;
    // false once the job is closed, expired or past its expiry date
    isOpen: boolean;
    company: { id: string; slug: string; name: string; logoUrl: string | null };
  } | null;
}

export interface RecruiterApplicationView extends ApplicationView {
  candidate: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

function toApplicationView(row: Application): ApplicationView {
  return {
    id: row.id,
    jobId: row.jobId,
    status: row.status,
    coverLetter: row.coverLetter,
    cvUrl: row.cvUrl,
    cvSize: row.cvSize,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function paginate<T extends { id: string }>(
  rows: T[],
  limit: number,
): { page: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { page, nextCursor: hasMore ? page[page.length - 1].id : null };
}

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly publicJobs: PublicJobsService,
    private readonly jobs: JobsService,
    private readonly auth: AuthService,
    private readonly events: EventEmitter2,
  ) {}

  async apply(
    candidateId: string,
    jobId: string,
    file: Express.Multer.File | undefined,
    dto: ApplyDto,
  ): Promise<ApplicationView> {
    // 404 for drafts and unknown ids; closed, expired and past-expiry jobs are not open
    const job = await this.publicJobs.getPublic(jobId);
    if (!job.isOpen) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'JOB_NOT_OPEN',
        'This job is no longer accepting applications',
        { status: job.status },
      );
    }
    if (!file) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'FILE_REQUIRED',
        'A PDF file is required in the "cv" field',
      );
    }
    if (!resolvePdfMime(file.mimetype, file.buffer)) {
      throw new AppException(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'FILE_INVALID_TYPE',
        'CV must be a PDF file',
      );
    }

    // checked before uploading so a duplicate leaves no orphan file
    const existing = await this.prisma.application.findUnique({
      where: { jobId_candidateId: { jobId: job.id, candidateId } },
      select: { id: true },
    });
    if (existing) throw this.alreadyApplied();

    const stored = await this.cloudinary.uploadPdf(file.buffer, CV_FOLDER);
    let row: Application;
    try {
      row = await this.prisma.application.create({
        data: {
          jobId: job.id,
          candidateId,
          coverLetter: dto.coverLetter,
          cvPublicId: stored.publicId,
          cvUrl: stored.secureUrl,
          cvSize: stored.size,
          cvMime: stored.mime,
        },
      });
    } catch (error) {
      // never leave an uploaded CV behind when the application was not saved
      await this.cloudinary.destroy(stored.publicId, 'raw');
      if (isUniqueViolation(error)) throw this.alreadyApplied();
      throw error;
    }

    const payload: ApplicationCreatedPayload = {
      applicationId: row.id,
      jobId: row.jobId,
      companyId: job.company.id,
      candidateId,
      occurredAt: new Date(),
    };
    this.events.emit(DomainEvents.ApplicationCreated, payload);

    return toApplicationView(row);
  }

  async listMine(
    candidateId: string,
    query: ListApplicationsQueryDto,
  ): Promise<Page<CandidateApplicationView>> {
    const rows = await this.prisma.application.findMany({
      where: { candidateId, status: query.status },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const { page, nextCursor } = paginate(rows, query.limit);

    const jobViews = await this.publicJobs.findPublicByIds([
      ...new Set(page.map((row) => row.jobId)),
    ]);
    const jobById = new Map(jobViews.map((job) => [job.id, job]));

    const items = page.map((row): CandidateApplicationView => {
      const job = jobById.get(row.jobId);
      return {
        ...toApplicationView(row),
        job: job
          ? {
              id: job.id,
              title: job.title,
              city: job.city,
              status: job.status,
              isOpen: job.isOpen,
              company: {
                id: job.company.id,
                slug: job.company.slug,
                name: job.company.name,
                logoUrl: job.company.logoUrl,
              },
            }
          : null,
      };
    });
    return { items, nextCursor };
  }

  async listForJob(
    recruiterId: string,
    jobId: string,
    query: ListApplicationsQueryDto,
  ): Promise<Page<RecruiterApplicationView>> {
    // a job of another company (or a recruiter without a company) looks like a missing job
    if (!(await this.jobs.ownsJob(recruiterId, jobId))) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        'JOB_NOT_FOUND',
        'Job not found',
      );
    }
    const rows = await this.prisma.application.findMany({
      where: { jobId, status: query.status },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const { page, nextCursor } = paginate(rows, query.limit);
    return { items: await this.toRecruiterViews(page), nextCursor };
  }

  async updateStatus(
    recruiterId: string,
    applicationId: string,
    to: ApplicationStatus,
  ): Promise<RecruiterApplicationView> {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
    });
    if (
      !application ||
      !(await this.jobs.ownsJob(recruiterId, application.jobId))
    ) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        'APPLICATION_NOT_FOUND',
        'Application not found',
      );
    }
    assertTransition(application.status, to);

    // conditional update: if the status changed since we read it, nothing is written
    const result = await this.prisma.application.updateMany({
      where: { id: application.id, status: application.status },
      data: { status: to },
    });
    if (result.count === 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'APPLICATION_INVALID_TRANSITION',
        'Application status changed in the meantime, please reload',
        { from: application.status, to },
      );
    }

    const payload: ApplicationStatusChangedPayload = {
      applicationId: application.id,
      jobId: application.jobId,
      candidateId: application.candidateId,
      from: application.status,
      to,
      occurredAt: new Date(),
    };
    this.events.emit(DomainEvents.ApplicationStatusChanged, payload);

    const updated = await this.prisma.application.findUniqueOrThrow({
      where: { id: application.id },
    });
    const [view] = await this.toRecruiterViews([updated]);
    return view;
  }

  private async toRecruiterViews(
    rows: Application[],
  ): Promise<RecruiterApplicationView[]> {
    const profiles = await this.auth.findProfilesByIds([
      ...new Set(rows.map((row) => row.candidateId)),
    ]);
    const byId = new Map(profiles.map((profile) => [profile.id, profile]));
    return rows.map((row): RecruiterApplicationView => {
      const profile = byId.get(row.candidateId);
      return {
        ...toApplicationView(row),
        candidate: profile
          ? {
              id: profile.id,
              firstName: profile.firstName,
              lastName: profile.lastName,
              email: profile.email,
            }
          : null,
      };
    });
  }

  private alreadyApplied(): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      'APPLICATION_ALREADY_EXISTS',
      'You have already applied to this job',
    );
  }
}
