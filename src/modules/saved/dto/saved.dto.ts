import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AlertFrequency } from '../../../generated/prisma/enums';
import { searchFiltersSchema } from '../../search/dto/search.dto';

const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const name = z.string().trim().min(1).max(100);

// a saved search without any criterion would alert on every new job
const hasCriteria = (filters: Record<string, unknown>): boolean =>
  Object.values(filters).some((value) => value !== undefined);
const filters = searchFiltersSchema.refine(hasCriteria, {
  message: 'At least one search criterion is required',
});

export const createSavedSearchSchema = z.object({
  name,
  filters,
  frequency: z.enum(AlertFrequency).default(AlertFrequency.DAILY),
  alertsEnabled: z.boolean().default(true),
});

export const updateSavedSearchSchema = z.object({
  name: name.optional(),
  filters: filters.optional(),
  frequency: z.enum(AlertFrequency).optional(),
  alertsEnabled: z.boolean().optional(),
});

export const savedListQuerySchema = z.object({
  limit: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(50).default(20),
  ),
  cursor: z.preprocess(blankToUndefined, z.string().min(1).max(64).optional()),
});

export class CreateSavedSearchDto extends createZodDto(
  createSavedSearchSchema,
) {}
export class UpdateSavedSearchDto extends createZodDto(
  updateSavedSearchSchema,
) {}
export class SavedListQueryDto extends createZodDto(savedListQuerySchema) {}
