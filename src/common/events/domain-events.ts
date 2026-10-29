import type { ApplicationStatus } from '../../generated/prisma/enums';

export const DomainEvents = {
  JobPublished: 'job.published',
  JobClosed: 'job.closed',
  JobExpired: 'job.expired',
  JobRenewed: 'job.renewed',
  JobExpiringSoon: 'job.expiring_soon',
  ApplicationCreated: 'application.created',
  ApplicationStatusChanged: 'application.status_changed',
} as const;

// events that change whether a job is visible (used by the search cache and the lifecycle service)
export type JobEventName =
  | typeof DomainEvents.JobPublished
  | typeof DomainEvents.JobClosed
  | typeof DomainEvents.JobExpired
  | typeof DomainEvents.JobRenewed;

export interface JobEventPayload {
  jobId: string;
  companyId: string;
  occurredAt: Date;
}

export interface JobExpiringPayload extends JobEventPayload {
  expiresAt: Date;
}

export interface ApplicationCreatedPayload {
  applicationId: string;
  jobId: string;
  companyId: string;
  candidateId: string;
  occurredAt: Date;
}

export interface ApplicationStatusChangedPayload {
  applicationId: string;
  jobId: string;
  candidateId: string;
  from: ApplicationStatus;
  to: ApplicationStatus;
  occurredAt: Date;
}
