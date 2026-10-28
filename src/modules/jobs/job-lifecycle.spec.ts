import { describe, expect, it } from 'vitest';
import { AppException } from '../../common/errors/app.exception';
import { JobStatus } from '../../generated/prisma/enums';
import {
  applyTransition,
  isTransitionAllowed,
  type JobAction,
  type JobLifecycleFields,
} from './job-lifecycle';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date('2026-01-15T10:00:00.000Z');
const publishedBefore = new Date('2025-12-01T10:00:00.000Z');
const expiresBefore = new Date('2025-12-31T10:00:00.000Z');

const ALL_STATUSES = Object.values(JobStatus);
const ALL_ACTIONS: JobAction[] = ['publish', 'close', 'expire', 'renew'];

const ALLOWED: Array<[JobStatus, JobAction]> = [
  [JobStatus.DRAFT, 'publish'],
  [JobStatus.PUBLISHED, 'close'],
  [JobStatus.PUBLISHED, 'expire'],
  [JobStatus.CLOSED, 'renew'],
  [JobStatus.EXPIRED, 'renew'],
];

const FORBIDDEN: Array<[JobStatus, JobAction]> = ALL_STATUSES.flatMap(
  (status) =>
    ALL_ACTIONS.filter((action) => !isTransitionAllowed(status, action)).map(
      (action): [JobStatus, JobAction] => [status, action],
    ),
);

function stateOf(status: JobStatus): JobLifecycleFields {
  switch (status) {
    case JobStatus.DRAFT:
      return { status, publishedAt: null, expiresAt: null, closedAt: null };
    case JobStatus.PUBLISHED:
      return {
        status,
        publishedAt: publishedBefore,
        expiresAt: expiresBefore,
        closedAt: null,
      };
    default:
      return {
        status,
        publishedAt: publishedBefore,
        expiresAt: expiresBefore,
        closedAt: now,
      };
  }
}

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('transition table', () => {
  it('has exactly 5 allowed and 11 forbidden combinations', () => {
    expect(ALLOWED).toHaveLength(5);
    expect(FORBIDDEN).toHaveLength(
      ALL_STATUSES.length * ALL_ACTIONS.length - 5,
    );
  });

  it.each(ALLOWED)('allows %s -> %s', (status, action) => {
    expect(() =>
      applyTransition(stateOf(status), action, now, 30),
    ).not.toThrow();
  });

  it.each(FORBIDDEN)(
    'rejects %s -> %s with JOB_INVALID_TRANSITION',
    (status, action) => {
      const error = catchError(() =>
        applyTransition(stateOf(status), action, now, 30),
      );
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).code).toBe('JOB_INVALID_TRANSITION');
      expect((error as AppException).getStatus()).toBe(409);
    },
  );
});

describe('transition results', () => {
  it('publish sets publishedAt and expiresAt = now + 30 days', () => {
    const next = applyTransition(stateOf(JobStatus.DRAFT), 'publish', now, 30);
    expect(next).toEqual({
      status: JobStatus.PUBLISHED,
      publishedAt: now,
      expiresAt: new Date(now.getTime() + 30 * DAY_MS),
      closedAt: null,
    });
  });

  it('publish honours a custom expiry duration', () => {
    const next = applyTransition(stateOf(JobStatus.DRAFT), 'publish', now, 14);
    expect(next.expiresAt).toEqual(new Date(now.getTime() + 14 * DAY_MS));
  });

  it('close sets closedAt and keeps the other dates', () => {
    const next = applyTransition(
      stateOf(JobStatus.PUBLISHED),
      'close',
      now,
      30,
    );
    expect(next).toEqual({
      status: JobStatus.CLOSED,
      publishedAt: publishedBefore,
      expiresAt: expiresBefore,
      closedAt: now,
    });
  });

  it('expire moves to EXPIRED and sets closedAt', () => {
    const next = applyTransition(
      stateOf(JobStatus.PUBLISHED),
      'expire',
      now,
      30,
    );
    expect(next.status).toBe(JobStatus.EXPIRED);
    expect(next.closedAt).toEqual(now);
    expect(next.publishedAt).toEqual(publishedBefore);
  });

  it.each([JobStatus.CLOSED, JobStatus.EXPIRED])(
    'renew from %s keeps publishedAt, resets expiresAt and clears closedAt',
    (status) => {
      const next = applyTransition(stateOf(status), 'renew', now, 30);
      expect(next).toEqual({
        status: JobStatus.PUBLISHED,
        publishedAt: publishedBefore,
        expiresAt: new Date(now.getTime() + 30 * DAY_MS),
        closedAt: null,
      });
    },
  );
});

describe('input hygiene', () => {
  it('returns only lifecycle fields, never extra properties of the input row', () => {
    const row = {
      ...stateOf(JobStatus.PUBLISHED),
      id: 'job-1',
      title: 'Some title',
      skills: [{ skillId: 'skill-1' }],
    };
    for (const action of ['close', 'expire'] as const) {
      const keys = Object.keys(applyTransition(row, action, now, 30)).sort();
      expect(keys).toEqual(['closedAt', 'expiresAt', 'publishedAt', 'status']);
    }
  });
});
