import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from '../../common/errors/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { CreateSkillDto, UpdateSkillDto } from './dto/skill.dto';
import { findTermConflict, type SkillTermsInput } from './skills.rules';

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

  // admin management

  async create(dto: CreateSkillDto): Promise<SkillView> {
    await this.assertNoConflict({
      slug: dto.slug,
      name: dto.name,
      aliases: dto.aliases,
    });
    try {
      return await this.prisma.skill.create({
        data: { slug: dto.slug, name: dto.name, aliases: dto.aliases },
        select: SKILL_SELECT,
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw this.conflict('slug or name', dto.slug);
      throw error;
    }
  }

  // renaming or changing aliases refreshes the search vector of the jobs that use the skill (DB trigger)
  async update(id: string, dto: UpdateSkillDto): Promise<SkillView> {
    const existing = await this.prisma.skill.findUnique({
      where: { id },
      select: SKILL_SELECT,
    });
    if (!existing) throw this.notFound();

    await this.assertNoConflict(
      {
        slug: existing.slug,
        name: dto.name ?? existing.name,
        aliases: dto.aliases ?? existing.aliases,
      },
      id,
    );
    try {
      return await this.prisma.skill.update({
        where: { id },
        data: { name: dto.name, aliases: dto.aliases },
        select: SKILL_SELECT,
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw this.conflict('name', dto.name ?? existing.name);
      throw error;
    }
  }

  // a skill used by jobs cannot be deleted (it would silently strip it from them)
  async remove(id: string): Promise<void> {
    const skill = await this.prisma.skill.findUnique({
      where: { id },
      select: { id: true, _count: { select: { jobs: true } } },
    });
    if (!skill) throw this.notFound();
    if (skill._count.jobs > 0) throw this.inUse(skill._count.jobs);

    try {
      await this.prisma.skill.delete({ where: { id } });
    } catch (error) {
      // a job started using the skill between the check and the delete; the database refused
      if (isForeignKeyViolation(error)) throw this.inUse();
      throw error;
    }
  }

  private async assertNoConflict(
    candidate: SkillTermsInput,
    selfId?: string,
  ): Promise<void> {
    const existing = await this.prisma.skill.findMany({ select: SKILL_SELECT });
    const conflict = findTermConflict(candidate, existing, selfId);
    if (conflict) throw this.conflict(conflict.term, conflict.with);
  }

  private conflict(term: string, owner: string): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      'SKILL_CONFLICT',
      `"${term}" is already used by "${owner}"`,
      { term, with: owner },
    );
  }

  private inUse(jobs?: number): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      'SKILL_IN_USE',
      'This skill is used by jobs and cannot be deleted',
      jobs === undefined ? undefined : { jobs },
    );
  }

  private notFound(): AppException {
    return new AppException(
      HttpStatus.NOT_FOUND,
      'SKILL_NOT_FOUND',
      'Skill not found',
    );
  }
}
