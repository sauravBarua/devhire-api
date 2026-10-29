import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { SearchCacheService } from './search-cache.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [JobsModule],
  controllers: [SearchController],
  providers: [SearchService, SearchCacheService],
  exports: [SearchService],
})
export class SearchModule {}
