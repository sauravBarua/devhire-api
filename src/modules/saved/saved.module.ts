import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { SavedJobsController } from './saved-jobs.controller';
import { SavedJobsService } from './saved-jobs.service';
import { SavedSearchesController } from './saved-searches.controller';
import { SavedSearchesService } from './saved-searches.service';

@Module({
  imports: [JobsModule],
  controllers: [SavedJobsController, SavedSearchesController],
  providers: [SavedJobsService, SavedSearchesService],
  exports: [SavedSearchesService],
})
export class SavedModule {}
