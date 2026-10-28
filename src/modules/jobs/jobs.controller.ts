import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { Role } from '../../generated/prisma/enums';
import { CreateJobDto, ListJobsQueryDto, UpdateJobDto } from './dto/job.dto';
import { JobsService, type JobPage } from './jobs.service';
import type { JobView } from './jobs.view';

@Roles(Role.RECRUITER)
@Controller('recruiter/jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateJobDto,
  ): Promise<JobView> {
    return this.jobs.create(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListJobsQueryDto,
  ): Promise<JobPage> {
    return this.jobs.list(user.id, query);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<JobView> {
    return this.jobs.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateJobDto,
  ): Promise<JobView> {
    return this.jobs.update(user.id, id, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.jobs.remove(user.id, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/publish')
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<JobView> {
    return this.jobs.publish(user.id, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/close')
  close(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<JobView> {
    return this.jobs.close(user.id, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/renew')
  renew(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<JobView> {
    return this.jobs.renew(user.id, id);
  }
}
