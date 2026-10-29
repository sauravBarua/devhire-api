import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { Role } from '../../generated/prisma/enums';
import { SavedListQueryDto } from './dto/saved.dto';
import {
  SavedJobsService,
  type SavedJobItem,
  type SavedJobView,
  type SavedPage,
} from './saved-jobs.service';

@Roles(Role.CANDIDATE)
@Controller('saved-jobs')
export class SavedJobsController {
  constructor(private readonly savedJobs: SavedJobsService) {}

  @HttpCode(HttpStatus.OK)
  @Put(':jobId')
  save(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
  ): Promise<SavedJobView> {
    return this.savedJobs.save(user.id, jobId);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':jobId')
  unsave(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
  ): Promise<void> {
    return this.savedJobs.unsave(user.id, jobId);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: SavedListQueryDto,
  ): Promise<SavedPage<SavedJobItem>> {
    return this.savedJobs.list(user.id, query);
  }
}
