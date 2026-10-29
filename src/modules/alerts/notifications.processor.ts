import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job as BullJob } from 'bullmq';
import { ENV, type Env } from '../../config/env';
import { Prisma } from '../../generated/prisma/client';
import { MailerService } from '../../infra/mailer/mailer.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { CompaniesService } from '../companies/companies.service';
import { PublicJobsService } from '../jobs/public-jobs.service';
import { SavedSearchesService } from '../saved/saved-searches.service';
import { buildLinks, type EmailLinks } from './email-links';
import {
  expiryReminderEmail,
  newApplicationEmail,
  searchAlertEmail,
} from './email-templates';
import {
  NOTIFICATIONS_QUEUE,
  NotificationJobs,
  type ExpiryReminderData,
  type NewApplicationData,
  type SearchAlertData,
} from './notifications.types';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_JOBS_IN_EMAIL = 20;

interface ClaimedMatch {
  id: string;
  jobId: string;
}

@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);
  private readonly links: EmailLinks;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly savedSearches: SavedSearchesService,
    private readonly publicJobs: PublicJobsService,
    private readonly companies: CompaniesService,
    private readonly auth: AuthService,
    @Inject(ENV) env: Env,
  ) {
    super();
    this.links = buildLinks(env.WEB_URL);
  }

  async process(job: BullJob): Promise<void> {
    switch (job.name) {
      case NotificationJobs.SearchAlert:
        return this.sendSearchAlert(job.data as SearchAlertData);
      case NotificationJobs.ExpiryReminder:
        return this.sendExpiryReminder(job.data as ExpiryReminderData);
      case NotificationJobs.NewApplication:
        return this.sendNewApplication(job.data as NewApplicationData);
      default:
        this.logger.warn(`Ignoring unknown notification job "${job.name}"`);
    }
  }

  // Claims all unsent matches atomically, then sends one email. If sending fails the claim is
  // released and the error rethrown, so BullMQ retries without ever sending twice or losing a match.
  private async sendSearchAlert(data: SearchAlertData): Promise<void> {
    const savedSearch = await this.savedSearches.findById(data.savedSearchId);
    if (!savedSearch || !savedSearch.alertsEnabled) return;

    const claimed = await this.claimPending(savedSearch.id);
    if (claimed.length === 0) return;

    try {
      const [user] = await this.auth.findProfilesByIds([savedSearch.userId]);
      const views = await this.publicJobs.findPublicByIds(
        claimed.map((match) => match.jobId),
      );
      // jobs closed or expired since the match are not worth an email
      const open = views
        .filter((view) => view.isOpen)
        .sort(
          (a, b) =>
            (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
        );
      if (!user || open.length === 0) return;

      const shown = open.slice(0, MAX_JOBS_IN_EMAIL);
      const email = searchAlertEmail({
        firstName: user.firstName,
        searchName: savedSearch.name,
        jobs: shown.map((view) => ({
          title: view.title,
          companyName: view.company.name,
          city: view.city,
          contractType: view.contractType,
          url: this.links.job(view.id),
        })),
        extraCount: open.length - shown.length,
        searchUrl: this.links.search(savedSearch.filters),
      });
      await this.mailer.send({ to: user.email, ...email });
    } catch (error) {
      await this.releaseClaim(claimed.map((match) => match.id));
      throw error;
    }
  }

  private async sendExpiryReminder(data: ExpiryReminderData): Promise<void> {
    const [job] = await this.publicJobs.findPublicByIds([data.jobId]);
    if (!job || !job.isOpen || !job.expiresAt) return;

    const ownerId = await this.companies.findOwnerId(job.company.id);
    if (!ownerId) return;
    const [recruiter] = await this.auth.findProfilesByIds([ownerId]);
    if (!recruiter) return;

    const daysLeft = Math.max(
      1,
      Math.ceil((job.expiresAt.getTime() - Date.now()) / DAY_MS),
    );
    const email = expiryReminderEmail({
      firstName: recruiter.firstName,
      jobTitle: job.title,
      expiresAt: job.expiresAt,
      daysLeft,
      manageUrl: this.links.recruiterJob(job.id),
    });
    await this.mailer.send({ to: recruiter.email, ...email });
  }

  private async sendNewApplication(data: NewApplicationData): Promise<void> {
    const [job] = await this.publicJobs.findPublicByIds([data.jobId]);
    const ownerId = await this.companies.findOwnerId(data.companyId);
    if (!job || !ownerId) return;

    const profiles = await this.auth.findProfilesByIds([
      ownerId,
      data.candidateId,
    ]);
    const recruiter = profiles.find((profile) => profile.id === ownerId);
    const candidate = profiles.find(
      (profile) => profile.id === data.candidateId,
    );
    if (!recruiter || !candidate) return;

    const email = newApplicationEmail({
      firstName: recruiter.firstName,
      candidateName: `${candidate.firstName} ${candidate.lastName}`,
      jobTitle: job.title,
      applicationsUrl: this.links.recruiterApplications(job.id),
    });
    await this.mailer.send({ to: recruiter.email, ...email });
  }

  // timestamps are stored as UTC without a time zone
  private claimPending(savedSearchId: string): Promise<ClaimedMatch[]> {
    return this.prisma.$queryRaw<ClaimedMatch[]>(Prisma.sql`
      UPDATE "AlertMatch"
      SET "notifiedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "id" IN (
        SELECT "id" FROM "AlertMatch"
        WHERE "savedSearchId" = ${savedSearchId}::text AND "notifiedAt" IS NULL
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "jobId"`);
  }

  private async releaseClaim(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.alertMatch.updateMany({
      where: { id: { in: ids } },
      data: { notifiedAt: null },
    });
  }
}
