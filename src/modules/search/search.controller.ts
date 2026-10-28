import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { SearchQueryDto } from './dto/search.dto';
import { SearchService, type SearchResult } from './search.service';

@Public()
@Controller('jobs')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  searchJobs(@Query() query: SearchQueryDto): Promise<SearchResult> {
    return this.search.search(query);
  }
}
