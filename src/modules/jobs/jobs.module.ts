import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { SkillsModule } from '../skills/skills.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { PublicJobsController } from './public-jobs.controller';
import { PublicJobsService } from './public-jobs.service';

@Module({
  imports: [CompaniesModule, SkillsModule],
  controllers: [JobsController, PublicJobsController],
  providers: [JobsService, PublicJobsService],
  exports: [JobsService, PublicJobsService],
})
export class JobsModule {}
