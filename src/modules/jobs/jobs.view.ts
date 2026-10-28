import type { Job } from '../../generated/prisma/client';
import type {
  ContractType,
  ExperienceLevel,
  JobCategory,
  JobStatus,
  RemotePolicy,
} from '../../generated/prisma/enums';

export interface JobSkillView {
  slug: string;
  name: string;
}

export interface JobView {
  id: string;
  companyId: string;
  title: string;
  description: string;
  category: JobCategory;
  contractType: ContractType;
  remotePolicy: RemotePolicy;
  experienceLevel: ExperienceLevel;
  city: string | null;
  region: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  status: JobStatus;
  publishedAt: Date | null;
  expiresAt: Date | null;
  closedAt: Date | null;
  // whole days since first publication; renewals do not reset it
  postedDaysAgo: number | null;
  skills: JobSkillView[];
  createdAt: Date;
  updatedAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysSince(date: Date | null, now: Date): number | null {
  if (!date) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS));
}

export function toJobView(
  job: Job,
  skills: JobSkillView[],
  now: Date,
): JobView {
  return {
    id: job.id,
    companyId: job.companyId,
    title: job.title,
    description: job.description,
    category: job.category,
    contractType: job.contractType,
    remotePolicy: job.remotePolicy,
    experienceLevel: job.experienceLevel,
    city: job.city,
    region: job.region,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    status: job.status,
    publishedAt: job.publishedAt,
    expiresAt: job.expiresAt,
    closedAt: job.closedAt,
    postedDaysAgo: daysSince(job.publishedAt, now),
    skills,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export interface PublicJobView {
  id: string;
  title: string;
  description: string;
  category: JobCategory;
  contractType: ContractType;
  remotePolicy: RemotePolicy;
  experienceLevel: ExperienceLevel;
  city: string | null;
  region: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  status: JobStatus;
  // true only while the job is PUBLISHED and not past expiresAt ("Offre clôturée" otherwise)
  isOpen: boolean;
  publishedAt: Date | null;
  expiresAt: Date | null;
  closedAt: Date | null;
  postedDaysAgo: number | null;
  skills: JobSkillView[];
  company: {
    id: string;
    slug: string;
    name: string;
    logoUrl: string | null;
    city: string | null;
  };
}

export function toPublicJobView(
  job: Job,
  skills: JobSkillView[],
  company: {
    id: string;
    slug: string;
    name: string;
    logoUrl: string | null;
    city: string | null;
  },
  now: Date,
): PublicJobView {
  return {
    id: job.id,
    title: job.title,
    description: job.description,
    category: job.category,
    contractType: job.contractType,
    remotePolicy: job.remotePolicy,
    experienceLevel: job.experienceLevel,
    city: job.city,
    region: job.region,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    status: job.status,
    isOpen:
      job.status === 'PUBLISHED' &&
      job.expiresAt !== null &&
      job.expiresAt > now,
    publishedAt: job.publishedAt,
    expiresAt: job.expiresAt,
    closedAt: job.closedAt,
    postedDaysAgo: daysSince(job.publishedAt, now),
    skills,
    company: {
      id: company.id,
      slug: company.slug,
      name: company.name,
      logoUrl: company.logoUrl,
      city: company.city,
    },
  };
}
