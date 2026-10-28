export const DomainEvents = {
  JobPublished: 'job.published',
  JobClosed: 'job.closed',
  JobExpired: 'job.expired',
  JobRenewed: 'job.renewed',
} as const;

export type JobEventName = (typeof DomainEvents)[keyof typeof DomainEvents];

export interface JobEventPayload {
  jobId: string;
  companyId: string;
  occurredAt: Date;
}
