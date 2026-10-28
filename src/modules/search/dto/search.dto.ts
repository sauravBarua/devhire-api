import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  ContractType,
  ExperienceLevel,
  JobCategory,
  RemotePolicy,
} from '../../../generated/prisma/enums';

const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

// accepts "a,b", ["a","b"] or repeated params; empty becomes undefined
function toList(value: unknown): unknown {
  if (value === undefined) return undefined;
  const raw: unknown[] = Array.isArray(value) ? value : [value];
  const items = raw
    .flatMap((entry) =>
      typeof entry === 'string' ? entry.split(',') : [entry],
    )
    .map((entry) => (typeof entry === 'string' ? entry.trim() : entry))
    .filter((entry) => entry !== '');
  return items.length > 0 ? [...new Set(items)] : undefined;
}

const list = <T extends z.ZodType>(item: T) =>
  z.preprocess(toList, z.array(item).max(10).optional());

const text = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
const salary = z.preprocess(
  blankToUndefined,
  z.coerce.number().int().min(0).max(1_000_000).optional(),
);

export const searchQuerySchema = z
  .object({
    q: text(200),
    category: list(z.string().toUpperCase().pipe(z.enum(JobCategory))),
    contractType: list(z.string().toUpperCase().pipe(z.enum(ContractType))),
    remotePolicy: list(z.string().toUpperCase().pipe(z.enum(RemotePolicy))),
    experienceLevel: list(
      z.string().toUpperCase().pipe(z.enum(ExperienceLevel)),
    ),
    skills: list(z.string().trim().toLowerCase().min(1).max(50)),
    city: text(100),
    region: text(100),
    salaryMin: salary,
    salaryMax: salary,
    postedWithin: z.preprocess(
      blankToUndefined,
      z.enum(['24h', '7d', '14d', '30d']).optional(),
    ),
    sort: z.preprocess(
      blankToUndefined,
      z.enum(['relevance', 'date']).optional(),
    ),
    limit: z.preprocess(
      blankToUndefined,
      z.coerce.number().int().min(1).max(50).default(20),
    ),
    cursor: text(400),
  })
  .refine(
    (value) =>
      value.salaryMin === undefined ||
      value.salaryMax === undefined ||
      value.salaryMin <= value.salaryMax,
    {
      message: 'salaryMin must be less than or equal to salaryMax',
      path: ['salaryMin'],
    },
  );

export type SearchQuery = z.output<typeof searchQuerySchema>;

export class SearchQueryDto extends createZodDto(searchQuerySchema) {}
