import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { SkillsModule } from '../skills/skills.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [CompaniesModule, SkillsModule],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
