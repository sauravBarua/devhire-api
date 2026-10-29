import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { SkillsModule } from '../skills/skills.module';
import { JobExpiryService } from './job-expiry.service';
import { JobModerationService } from './job-moderation.service';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { PublicJobsController } from './public-jobs.controller';
import { PublicJobsService } from './public-jobs.service';

@Module({
  imports: [CompaniesModule, SkillsModule],
  controllers: [JobsController, PublicJobsController],
  providers: [
    JobsService,
    PublicJobsService,
    JobExpiryService,
    JobModerationService,
  ],
  exports: [
    JobsService,
    PublicJobsService,
    JobExpiryService,
    JobModerationService,
  ],
})
export class JobsModule {}
