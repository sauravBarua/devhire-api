import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  ContractType,
  ExperienceLevel,
  JobCategory,
  JobStatus,
  RemotePolicy,
} from '../../../generated/prisma/enums';

const title = z.string().trim().min(3).max(150);
const description = z.string().trim().min(20).max(20000);
const place = z.string().trim().min(1).max(100);
const salary = z.number().int().min(0).max(1_000_000);
const skillSlugs = z
  .array(z.string().trim().toLowerCase().min(1).max(50))
  .max(15);

const salaryOrdered = (value: {
  salaryMin?: number | null;
  salaryMax?: number | null;
}): boolean =>
  value.salaryMin == null ||
  value.salaryMax == null ||
  value.salaryMin <= value.salaryMax;
const salaryIssue = {
  message: 'salaryMin must be less than or equal to salaryMax',
  path: ['salaryMin'],
};

export const createJobSchema = z
  .object({
    title,
    description,
    category: z.enum(JobCategory),
    contractType: z.enum(ContractType),
    remotePolicy: z.enum(RemotePolicy),
    experienceLevel: z.enum(ExperienceLevel),
    city: place.optional(),
    region: place.optional(),
    salaryMin: salary.optional(),
    salaryMax: salary.optional(),
    skills: skillSlugs.default([]),
  })
  .refine(salaryOrdered, salaryIssue);

// null clears an optional field, omitting a field leaves it unchanged,
// "skills" replaces the whole set when present
export const updateJobSchema = z
  .object({
    title: title.optional(),
    description: description.optional(),
    category: z.enum(JobCategory).optional(),
    contractType: z.enum(ContractType).optional(),
    remotePolicy: z.enum(RemotePolicy).optional(),
    experienceLevel: z.enum(ExperienceLevel).optional(),
    city: place.nullable().optional(),
    region: place.nullable().optional(),
    salaryMin: salary.nullable().optional(),
    salaryMax: salary.nullable().optional(),
    skills: skillSlugs.optional(),
  })
  .refine(salaryOrdered, salaryIssue);

export const listJobsQuerySchema = z.object({
  status: z.enum(JobStatus).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(64).optional(),
});

export class CreateJobDto extends createZodDto(createJobSchema) {}
export class UpdateJobDto extends createZodDto(updateJobSchema) {}
export class ListJobsQueryDto extends createZodDto(listJobsQuerySchema) {}
