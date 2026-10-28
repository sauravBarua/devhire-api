import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { SkillsService, type SkillView } from './skills.service';

@Controller('skills')
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Public()
  @Get()
  list(): Promise<SkillView[]> {
    return this.skills.list();
  }
}
