import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface SkillView {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
}

const SKILL_SELECT = {
  id: true,
  slug: true,
  name: true,
  aliases: true,
} as const;

@Injectable()
export class SkillsService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<SkillView[]> {
    return this.prisma.skill.findMany({
      orderBy: { name: 'asc' },
      select: SKILL_SELECT,
    });
  }

  // public entry points for other modules (jobs), so they never touch the skills table
  findBySlugs(slugs: string[]): Promise<SkillView[]> {
    return this.prisma.skill.findMany({
      where: { slug: { in: slugs } },
      select: SKILL_SELECT,
    });
  }

  findByIds(ids: string[]): Promise<SkillView[]> {
    return this.prisma.skill.findMany({
      where: { id: { in: ids } },
      select: SKILL_SELECT,
    });
  }
}
