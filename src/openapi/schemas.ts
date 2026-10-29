import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  AlertFrequency,
  ApplicationStatus,
  ContractType,
  ExperienceLevel,
  JobCategory,
  JobStatus,
  RemotePolicy,
  Role,
} from '../generated/prisma/enums';

// Response shapes, used for the OpenAPI document and checked against real responses in
// test/openapi.e2e-spec.ts. Objects are strict so a field leaking into a response fails that test.

const dateTime = z.iso.datetime();
const nullableDateTime = dateTime.nullable();
const nullableString = z.string().nullable();
const nullableInt = z.number().int().nullable();
const cursor = z.string().nullable();
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item), nextCursor: cursor });

export const errorSchema = z.object({
  statusCode: z.number().int(),
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
  path: z.string(),
});

export const userSchema = z.strictObject({
  id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  role: z.enum(Role),
  createdAt: dateTime,
});

export const authSchema = z.strictObject({
  accessToken: z.string(),
  user: userSchema,
});

export const companySchema = z.strictObject({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: nullableString,
  website: nullableString,
  city: nullableString,
  logoUrl: nullableString,
  isHidden: z.boolean(),
  createdAt: dateTime,
  updatedAt: dateTime,
});

export const skillSchema = z.strictObject({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
});

const jobSkillSchema = z.strictObject({ slug: z.string(), name: z.string() });

export const jobSchema = z.strictObject({
  id: z.string(),
  companyId: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.enum(JobCategory),
  contractType: z.enum(ContractType),
  remotePolicy: z.enum(RemotePolicy),
  experienceLevel: z.enum(ExperienceLevel),
  city: nullableString,
  region: nullableString,
  salaryMin: nullableInt,
  salaryMax: nullableInt,
  status: z.enum(JobStatus),
  publishedAt: nullableDateTime,
  expiresAt: nullableDateTime,
  closedAt: nullableDateTime,
  moderatedAt: nullableDateTime,
  moderationReason: nullableString,
  postedDaysAgo: nullableInt,
  skills: z.array(jobSkillSchema),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export const jobPageSchema = page(jobSchema);

const publicJobCore = {
  id: z.string(),
  title: z.string(),
  category: z.enum(JobCategory),
  contractType: z.enum(ContractType),
  remotePolicy: z.enum(RemotePolicy),
  experienceLevel: z.enum(ExperienceLevel),
  city: nullableString,
  region: nullableString,
  salaryMin: nullableInt,
  salaryMax: nullableInt,
  status: z.enum(JobStatus),
  isOpen: z.boolean(),
  publishedAt: nullableDateTime,
  expiresAt: nullableDateTime,
  closedAt: nullableDateTime,
  postedDaysAgo: nullableInt,
  skills: z.array(jobSkillSchema),
  company: z.strictObject({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    logoUrl: nullableString,
    city: nullableString,
  }),
};
export const publicJobSchema = z.strictObject({
  ...publicJobCore,
  description: z.string(),
});
const publicJobSummarySchema = z.strictObject({
  ...publicJobCore,
  excerpt: z.string(),
});

const facetCount = z.strictObject({
  value: z.string(),
  count: z.number().int(),
});
const skillFacetCount = z.strictObject({
  value: z.string(),
  label: z.string(),
  count: z.number().int(),
});
export const searchResultSchema = z.strictObject({
  items: z.array(publicJobSummarySchema),
  nextCursor: cursor,
  // total and facets are only computed for the first page (no cursor)
  total: nullableInt,
  facets: z
    .strictObject({
      category: z.array(facetCount),
      contractType: z.array(facetCount),
      remotePolicy: z.array(facetCount),
      experienceLevel: z.array(facetCount),
      skills: z.array(skillFacetCount),
      cities: z.array(facetCount),
    })
    .nullable(),
});

const applicationFields = {
  id: z.string(),
  jobId: z.string(),
  status: z.enum(ApplicationStatus),
  coverLetter: nullableString,
  cvUrl: z.string(),
  cvSize: z.number().int(),
  createdAt: dateTime,
  updatedAt: dateTime,
};
export const applicationSchema = z.strictObject(applicationFields);
const candidateApplicationSchema = z.strictObject({
  ...applicationFields,
  job: z
    .strictObject({
      id: z.string(),
      title: z.string(),
      city: nullableString,
      status: z.enum(JobStatus),
      isOpen: z.boolean(),
      company: z.strictObject({
        id: z.string(),
        slug: z.string(),
        name: z.string(),
        logoUrl: nullableString,
      }),
    })
    .nullable(),
});
export const candidateApplicationPageSchema = page(candidateApplicationSchema);
export const recruiterApplicationSchema = z.strictObject({
  ...applicationFields,
  candidate: z
    .strictObject({
      id: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      email: z.string(),
    })
    .nullable(),
});
export const recruiterApplicationPageSchema = page(recruiterApplicationSchema);

export const savedJobSchema = z.strictObject({
  id: z.string(),
  jobId: z.string(),
  savedAt: dateTime,
});
const savedJobItemSchema = z.strictObject({
  ...savedJobSchema.shape,
  job: z
    .strictObject({
      id: z.string(),
      title: z.string(),
      city: nullableString,
      contractType: z.enum(ContractType),
      remotePolicy: z.enum(RemotePolicy),
      experienceLevel: z.enum(ExperienceLevel),
      status: z.enum(JobStatus),
      isOpen: z.boolean(),
      publishedAt: nullableDateTime,
      expiresAt: nullableDateTime,
      closedAt: nullableDateTime,
      postedDaysAgo: nullableInt,
      company: z.strictObject({
        id: z.string(),
        slug: z.string(),
        name: z.string(),
        logoUrl: nullableString,
      }),
    })
    .nullable(),
});
export const savedJobPageSchema = page(savedJobItemSchema);

export const savedSearchSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  filters: z.record(z.string(), z.unknown()),
  frequency: z.enum(AlertFrequency),
  alertsEnabled: z.boolean(),
  createdAt: dateTime,
  updatedAt: dateTime,
});

export const adminJobSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  status: z.enum(JobStatus),
  category: z.enum(JobCategory),
  city: nullableString,
  publishedAt: nullableDateTime,
  expiresAt: nullableDateTime,
  closedAt: nullableDateTime,
  moderatedAt: nullableDateTime,
  moderationReason: nullableString,
  company: z
    .strictObject({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      isHidden: z.boolean(),
    })
    .nullable(),
});
export const adminJobPageSchema = page(adminJobSchema);
export const adminCompanySchema = z.strictObject({
  ...companySchema.shape,
  ownerId: z.string(),
  hiddenAt: nullableDateTime,
  hiddenReason: nullableString,
});
export const adminCompanyPageSchema = page(adminCompanySchema);

export const healthLiveSchema = z.strictObject({ status: z.literal('ok') });
export const healthReadySchema = z.strictObject({
  status: z.literal('ok'),
  checks: z.strictObject({ database: z.literal('up'), redis: z.literal('up') }),
});

// One class per schema: the class name is the schema name in the OpenAPI document.
export class ErrorResponse extends createZodDto(errorSchema) {}
export class UserResponse extends createZodDto(userSchema) {}
export class AuthResponse extends createZodDto(authSchema) {}
export class CompanyResponse extends createZodDto(companySchema) {}
export class SkillResponse extends createZodDto(skillSchema) {}
export class JobResponse extends createZodDto(jobSchema) {}
export class JobPageResponse extends createZodDto(jobPageSchema) {}
export class PublicJobResponse extends createZodDto(publicJobSchema) {}
export class SearchResultResponse extends createZodDto(searchResultSchema) {}
export class ApplicationResponse extends createZodDto(applicationSchema) {}
export class CandidateApplicationPageResponse extends createZodDto(
  candidateApplicationPageSchema,
) {}
export class RecruiterApplicationResponse extends createZodDto(
  recruiterApplicationSchema,
) {}
export class RecruiterApplicationPageResponse extends createZodDto(
  recruiterApplicationPageSchema,
) {}
export class SavedJobResponse extends createZodDto(savedJobSchema) {}
export class SavedJobPageResponse extends createZodDto(savedJobPageSchema) {}
export class SavedSearchResponse extends createZodDto(savedSearchSchema) {}
export class AdminJobResponse extends createZodDto(adminJobSchema) {}
export class AdminJobPageResponse extends createZodDto(adminJobPageSchema) {}
export class AdminCompanyResponse extends createZodDto(adminCompanySchema) {}
export class AdminCompanyPageResponse extends createZodDto(
  adminCompanyPageSchema,
) {}
export class HealthLiveResponse extends createZodDto(healthLiveSchema) {}
export class HealthReadyResponse extends createZodDto(healthReadySchema) {}

export const RESPONSE_MODELS = [
  ErrorResponse,
  UserResponse,
  AuthResponse,
  CompanyResponse,
  SkillResponse,
  JobResponse,
  JobPageResponse,
  PublicJobResponse,
  SearchResultResponse,
  ApplicationResponse,
  CandidateApplicationPageResponse,
  RecruiterApplicationResponse,
  RecruiterApplicationPageResponse,
  SavedJobResponse,
  SavedJobPageResponse,
  SavedSearchResponse,
  AdminJobResponse,
  AdminJobPageResponse,
  AdminCompanyResponse,
  AdminCompanyPageResponse,
  HealthLiveResponse,
  HealthReadyResponse,
];
