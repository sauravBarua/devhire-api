import { describe, expect, it } from 'vitest';
import { AppException } from '../../common/errors/app.exception';
import { ApplicationStatus } from '../../generated/prisma/enums';
import { assertTransition, canTransition } from './application-lifecycle';

const ALL = Object.values(ApplicationStatus);

const ALLOWED: Array<[ApplicationStatus, ApplicationStatus]> = [
  [ApplicationStatus.NEW, ApplicationStatus.REVIEWED],
  [ApplicationStatus.NEW, ApplicationStatus.INTERVIEW],
  [ApplicationStatus.NEW, ApplicationStatus.REJECTED],
  [ApplicationStatus.REVIEWED, ApplicationStatus.INTERVIEW],
  [ApplicationStatus.REVIEWED, ApplicationStatus.REJECTED],
  [ApplicationStatus.REVIEWED, ApplicationStatus.HIRED],
  [ApplicationStatus.INTERVIEW, ApplicationStatus.REJECTED],
  [ApplicationStatus.INTERVIEW, ApplicationStatus.HIRED],
];

const FORBIDDEN: Array<[ApplicationStatus, ApplicationStatus]> = ALL.flatMap(
  (from) =>
    ALL.filter((to) => !ALLOWED.some(([a, b]) => a === from && b === to)).map(
      (to): [ApplicationStatus, ApplicationStatus] => [from, to],
    ),
);

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('application transitions', () => {
  it('has 8 allowed and 17 forbidden combinations', () => {
    expect(ALLOWED).toHaveLength(8);
    expect(FORBIDDEN).toHaveLength(ALL.length * ALL.length - 8);
  });

  it.each(ALLOWED)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each(FORBIDDEN)(
    'rejects %s -> %s with APPLICATION_INVALID_TRANSITION',
    (from, to) => {
      expect(canTransition(from, to)).toBe(false);
      const error = catchError(() => assertTransition(from, to));
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).code).toBe(
        'APPLICATION_INVALID_TRANSITION',
      );
      expect((error as AppException).getStatus()).toBe(409);
    },
  );

  it('treats REJECTED and HIRED as final', () => {
    for (const final of [ApplicationStatus.REJECTED, ApplicationStatus.HIRED]) {
      for (const to of ALL) expect(canTransition(final, to)).toBe(false);
    }
  });
});
