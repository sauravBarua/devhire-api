import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { JobStatus } from '../../generated/prisma/enums';

export type JobAction = 'publish' | 'close' | 'expire' | 'renew';

export interface JobLifecycleFields {
  status: JobStatus;
  publishedAt: Date | null;
  expiresAt: Date | null;
  closedAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const ALLOWED_FROM: Record<JobAction, readonly JobStatus[]> = {
  publish: [JobStatus.DRAFT],
  close: [JobStatus.PUBLISHED],
  expire: [JobStatus.PUBLISHED],
  renew: [JobStatus.CLOSED, JobStatus.EXPIRED],
};

export function isTransitionAllowed(
  status: JobStatus,
  action: JobAction,
): boolean {
  return ALLOWED_FROM[action].includes(status);
}

// pure: returns ONLY the lifecycle fields (safe to pass to a DB update) or throws JOB_INVALID_TRANSITION
export function applyTransition(
  current: JobLifecycleFields,
  action: JobAction,
  now: Date,
  expiryDays: number,
): JobLifecycleFields {
  if (!isTransitionAllowed(current.status, action)) {
    throw new AppException(
      HttpStatus.CONFLICT,
      'JOB_INVALID_TRANSITION',
      `Cannot ${action} a job that is ${current.status}`,
      { from: current.status, action },
    );
  }

  const expiresAt = new Date(now.getTime() + expiryDays * DAY_MS);

  switch (action) {
    case 'publish':
      return {
        status: JobStatus.PUBLISHED,
        publishedAt: now,
        expiresAt,
        closedAt: null,
      };
    case 'close':
      return {
        status: JobStatus.CLOSED,
        publishedAt: current.publishedAt,
        expiresAt: current.expiresAt,
        closedAt: now,
      };
    case 'expire':
      return {
        status: JobStatus.EXPIRED,
        publishedAt: current.publishedAt,
        expiresAt: current.expiresAt,
        closedAt: now,
      };
    case 'renew':
      // a renewal keeps the original publishedAt so an old job never looks new
      return {
        status: JobStatus.PUBLISHED,
        publishedAt: current.publishedAt ?? now,
        expiresAt,
        closedAt: null,
      };
  }
}
