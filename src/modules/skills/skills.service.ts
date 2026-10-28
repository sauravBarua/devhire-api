import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface SkillView {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
}

@Injectable()
export class SkillsService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<SkillView[]> {
    return this.prisma.skill.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true, aliases: true },
    });
  }
}
