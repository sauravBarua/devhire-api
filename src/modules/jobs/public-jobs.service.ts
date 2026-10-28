import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { JobStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CompaniesService } from '../companies/companies.service';
import { SkillsService } from '../skills/skills.service';
import { toPublicJobView, type PublicJobView } from './jobs.view';

@Injectable()
export class PublicJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly skills: SkillsService,
  ) {}

  async getPublic(jobId: string): Promise<PublicJobView> {
    const [view] = await this.findPublicByIds([jobId]);
    if (!view)
      throw new AppException(
        HttpStatus.NOT_FOUND,
        'JOB_NOT_FOUND',
        'Job not found',
      );
    return view;
  }

  // drafts are never public; closed and expired jobs stay viewable by direct link.
  // The result keeps the order of the requested ids.
  async findPublicByIds(ids: string[]): Promise<PublicJobView[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.job.findMany({
      where: { id: { in: ids }, status: { not: JobStatus.DRAFT } },
      include: { skills: { select: { skillId: true } } },
    });

    const skillIds = [
      ...new Set(rows.flatMap((row) => row.skills.map((s) => s.skillId))),
    ];
    const companyIds = [...new Set(rows.map((row) => row.companyId))];
    const [skills, companies] = await Promise.all([
      skillIds.length > 0
        ? this.skills.findByIds(skillIds)
        : Promise.resolve([]),
      this.companies.findByIds(companyIds),
    ]);
    const skillById = new Map(skills.map((skill) => [skill.id, skill]));
    const companyById = new Map(
      companies.map((company) => [company.id, company]),
    );

    const now = new Date();
    const byId = new Map<string, PublicJobView>();
    for (const row of rows) {
      const company = companyById.get(row.companyId);
      if (!company) continue;
      const jobSkills = row.skills
        .flatMap(({ skillId }) => {
          const skill = skillById.get(skillId);
          return skill ? [{ slug: skill.slug, name: skill.name }] : [];
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      byId.set(row.id, toPublicJobView(row, jobSkills, company, now));
    }
    return ids.flatMap((id) => {
      const view = byId.get(id);
      return view ? [view] : [];
    });
  }
}
