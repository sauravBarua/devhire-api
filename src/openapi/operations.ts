import type { Type } from '@nestjs/common';
import { AdminController } from '../modules/admin/admin.controller';
import { ApplicationsController } from '../modules/applications/applications.controller';
import { AuthController } from '../modules/auth/auth.controller';
import { CompaniesController } from '../modules/companies/companies.controller';
import { HealthController } from '../modules/health/health.controller';
import { JobsController } from '../modules/jobs/jobs.controller';
import { PublicJobsController } from '../modules/jobs/public-jobs.controller';
import { SavedJobsController } from '../modules/saved/saved-jobs.controller';
import { SavedSearchesController } from '../modules/saved/saved-searches.controller';
import { SearchController } from '../modules/search/search.controller';
import { SkillsController } from '../modules/skills/skills.controller';

export type UploadBody = 'logo' | 'cv';

export interface OperationSpec {
  /** HTTP status of the success response */
  status: number;
  /** name of the response schema (a class from schemas.ts); omitted for "no content" */
  schema?: string;
  /** the response is an array of that schema */
  array?: boolean;
  /** multipart upload: the request body cannot be inferred from a DTO */
  upload?: UploadBody;
  /** the operation reads the httpOnly refresh_token cookie */
  cookie?: boolean;
}

export interface ControllerDocs {
  controller: Type<unknown>;
  tag: string;
  /** one entry per route handler of the controller; openapi.ts fails if one is missing or unknown */
  operations: Record<string, OperationSpec>;
}

const json = (
  status: number,
  schema: string,
  array = false,
): OperationSpec => ({
  status,
  schema,
  array,
});

export const CONTROLLER_DOCS: ControllerDocs[] = [
  {
    controller: AuthController,
    tag: 'Auth',
    operations: {
      register: json(201, 'AuthResponse'),
      login: json(200, 'AuthResponse'),
      refresh: { ...json(200, 'AuthResponse'), cookie: true },
      logout: { status: 204, cookie: true },
      me: json(200, 'UserResponse'),
    },
  },
  {
    controller: CompaniesController,
    tag: 'Companies',
    operations: {
      create: json(201, 'CompanyResponse'),
      getOwn: json(200, 'CompanyResponse'),
      updateOwn: json(200, 'CompanyResponse'),
      uploadLogo: { ...json(200, 'CompanyResponse'), upload: 'logo' },
      getBySlug: json(200, 'CompanyResponse'),
    },
  },
  {
    controller: SkillsController,
    tag: 'Skills',
    operations: { list: json(200, 'SkillResponse', true) },
  },
  {
    controller: JobsController,
    tag: 'Recruiter jobs',
    operations: {
      create: json(201, 'JobResponse'),
      list: json(200, 'JobPageResponse'),
      get: json(200, 'JobResponse'),
      update: json(200, 'JobResponse'),
      remove: { status: 204 },
      publish: json(200, 'JobResponse'),
      close: json(200, 'JobResponse'),
      renew: json(200, 'JobResponse'),
    },
  },
  {
    controller: PublicJobsController,
    tag: 'Jobs',
    operations: { get: json(200, 'PublicJobResponse') },
  },
  {
    controller: SearchController,
    tag: 'Jobs',
    operations: { searchJobs: json(200, 'SearchResultResponse') },
  },
  {
    controller: ApplicationsController,
    tag: 'Applications',
    operations: {
      apply: { ...json(201, 'ApplicationResponse'), upload: 'cv' },
      listMine: json(200, 'CandidateApplicationPageResponse'),
      listForJob: json(200, 'RecruiterApplicationPageResponse'),
      updateStatus: json(200, 'RecruiterApplicationResponse'),
    },
  },
  {
    controller: SavedJobsController,
    tag: 'Saved jobs',
    operations: {
      save: json(200, 'SavedJobResponse'),
      unsave: { status: 204 },
      list: json(200, 'SavedJobPageResponse'),
    },
  },
  {
    controller: SavedSearchesController,
    tag: 'Saved searches',
    operations: {
      create: json(201, 'SavedSearchResponse'),
      list: json(200, 'SavedSearchResponse', true),
      update: json(200, 'SavedSearchResponse'),
      remove: { status: 204 },
    },
  },
  {
    controller: AdminController,
    tag: 'Admin',
    operations: {
      listJobs: json(200, 'AdminJobPageResponse'),
      closeJob: json(200, 'AdminJobResponse'),
      listCompanies: json(200, 'AdminCompanyPageResponse'),
      hideCompany: json(200, 'AdminCompanyResponse'),
      restoreCompany: json(200, 'AdminCompanyResponse'),
      createSkill: json(201, 'SkillResponse'),
      updateSkill: json(200, 'SkillResponse'),
      deleteSkill: { status: 204 },
    },
  },
  {
    controller: HealthController,
    tag: 'Health',
    operations: {
      live: json(200, 'HealthLiveResponse'),
      ready: json(200, 'HealthReadyResponse'),
    },
  },
];
