import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PublicJobsService } from './public-jobs.service';
import type { PublicJobView } from './jobs.view';

@Public()
@Controller('jobs')
export class PublicJobsController {
  constructor(private readonly publicJobs: PublicJobsService) {}

  @Get(':id')
  get(@Param('id') id: string): Promise<PublicJobView> {
    return this.publicJobs.getPublic(id);
  }
}
