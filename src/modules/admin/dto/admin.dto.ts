import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { JobStatus } from '../../../generated/prisma/enums';

const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const limit = z.preprocess(
  blankToUndefined,
  z.coerce.number().int().min(1).max(50).default(20),
);
const cursor = z.preprocess(
  blankToUndefined,
  z.string().min(1).max(64).optional(),
);

// moderation needs an accountable reason
export const reasonSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const adminJobsQuerySchema = z.object({
  status: z.preprocess(blankToUndefined, z.enum(JobStatus).optional()),
  companyId: z.preprocess(
    blankToUndefined,
    z.string().min(1).max(64).optional(),
  ),
  limit,
  cursor,
});

export const adminCompaniesQuerySchema = z.object({
  hidden: z.preprocess(blankToUndefined, z.stringbool().optional()),
  q: z.preprocess(
    blankToUndefined,
    z.string().trim().min(1).max(100).optional(),
  ),
  limit,
  cursor,
});

export class ReasonDto extends createZodDto(reasonSchema) {}
export class AdminJobsQueryDto extends createZodDto(adminJobsQuerySchema) {}
export class AdminCompaniesQueryDto extends createZodDto(
  adminCompaniesQuerySchema,
) {}
