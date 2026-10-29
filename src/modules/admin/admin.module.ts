import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { JobsModule } from '../jobs/jobs.module';
import { SkillsModule } from '../skills/skills.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [JobsModule, CompaniesModule, SkillsModule],
  controllers: [AdminController],
})
export class AdminModule {}
