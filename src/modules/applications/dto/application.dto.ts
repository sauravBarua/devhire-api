import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ApplicationStatus } from '../../../generated/prisma/enums';

const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

// multipart text field next to the "cv" file
export const applySchema = z.object({
  coverLetter: z.preprocess(
    blankToUndefined,
    z.string().trim().max(5000).optional(),
  ),
});

export const listApplicationsQuerySchema = z.object({
  status: z.preprocess(blankToUndefined, z.enum(ApplicationStatus).optional()),
  limit: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(50).default(20),
  ),
  cursor: z.preprocess(blankToUndefined, z.string().min(1).max(64).optional()),
});

export const updateApplicationStatusSchema = z.object({
  status: z.enum(ApplicationStatus),
});

export class ApplyDto extends createZodDto(applySchema) {}
export class ListApplicationsQueryDto extends createZodDto(
  listApplicationsQuerySchema,
) {}
export class UpdateApplicationStatusDto extends createZodDto(
  updateApplicationStatusSchema,
) {}
