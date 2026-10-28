import type { ApplicationStatus } from '../../generated/prisma/enums';

export const DomainEvents = {
  JobPublished: 'job.published',
  JobClosed: 'job.closed',
  JobExpired: 'job.expired',
  JobRenewed: 'job.renewed',
  ApplicationCreated: 'application.created',
  ApplicationStatusChanged: 'application.status_changed',
} as const;

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
