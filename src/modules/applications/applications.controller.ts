import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { Role } from '../../generated/prisma/enums';
import {
  ApplicationsService,
  type ApplicationView,
  type CandidateApplicationView,
  type Page,
  type RecruiterApplicationView,
} from './applications.service';
import {
  ApplyDto,
  ListApplicationsQueryDto,
  UpdateApplicationStatusDto,
} from './dto/application.dto';

const MAX_CV_BYTES = 5 * 1024 * 1024;

@Controller()
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Roles(Role.CANDIDATE)
  @Post('jobs/:jobId/applications')
  @UseInterceptors(
    FileInterceptor('cv', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_CV_BYTES, files: 1 },
    }),
  )
  apply(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: ApplyDto,
  ): Promise<ApplicationView> {
    return this.applications.apply(user.id, jobId, file, dto);
  }

  @Roles(Role.CANDIDATE)
  @Get('applications/me')
  listMine(
    @CurrentUser() user: AuthUser,
    @Query() query: ListApplicationsQueryDto,
  ): Promise<Page<CandidateApplicationView>> {
    return this.applications.listMine(user.id, query);
  }

  @Roles(Role.RECRUITER)
  @Get('recruiter/jobs/:jobId/applications')
  listForJob(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @Query() query: ListApplicationsQueryDto,
  ): Promise<Page<RecruiterApplicationView>> {
    return this.applications.listForJob(user.id, jobId, query);
  }

  @Roles(Role.RECRUITER)
  @Patch('recruiter/applications/:id/status')
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateApplicationStatusDto,
  ): Promise<RecruiterApplicationView> {
    return this.applications.updateStatus(user.id, id, dto.status);
  }
}
