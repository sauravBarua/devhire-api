import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { ApplicationStatus } from '../../generated/prisma/enums';

// REJECTED and HIRED are final
const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  [ApplicationStatus.NEW]: [
    ApplicationStatus.REVIEWED,
    ApplicationStatus.INTERVIEW,
    ApplicationStatus.REJECTED,
  ],
  [ApplicationStatus.REVIEWED]: [
    ApplicationStatus.INTERVIEW,
    ApplicationStatus.REJECTED,
    ApplicationStatus.HIRED,
  ],
  [ApplicationStatus.INTERVIEW]: [
    ApplicationStatus.REJECTED,
    ApplicationStatus.HIRED,
  ],
  [ApplicationStatus.REJECTED]: [],
  [ApplicationStatus.HIRED]: [],
};

export function canTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): void {
  if (!canTransition(from, to)) {
    throw new AppException(
      HttpStatus.CONFLICT,
      'APPLICATION_INVALID_TRANSITION',
      `Cannot move an application from ${from} to ${to}`,
      { from, to },
    );
  }
}
