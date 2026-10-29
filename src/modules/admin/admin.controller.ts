import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import type { CursorPage } from '../../common/types/cursor-page';
import { Role } from '../../generated/prisma/enums';
import {
  CompaniesService,
  type AdminCompanyView,
} from '../companies/companies.service';
import {
  JobModerationService,
  type AdminJobView,
} from '../jobs/job-moderation.service';
import { CreateSkillDto, UpdateSkillDto } from '../skills/dto/skill.dto';
import { SkillsService, type SkillView } from '../skills/skills.service';
import {
  AdminCompaniesQueryDto,
  AdminJobsQueryDto,
  ReasonDto,
} from './dto/admin.dto';

@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  private readonly audit = new Logger('AdminAudit');

  constructor(
    private readonly jobs: JobModerationService,
    private readonly companies: CompaniesService,
    private readonly skills: SkillsService,
  ) {}

  @Get('jobs')
  listJobs(
    @Query() query: AdminJobsQueryDto,
  ): Promise<CursorPage<AdminJobView>> {
    return this.jobs.list(query);
  }

  @HttpCode(HttpStatus.OK)
  @Post('jobs/:id/close')
  async closeJob(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ): Promise<AdminJobView> {
    const view = await this.jobs.forceClose(id, dto.reason);
    this.record(admin, 'job.force_close', id, dto.reason);
    return view;
  }

  @Get('companies')
  listCompanies(
    @Query() query: AdminCompaniesQueryDto,
  ): Promise<CursorPage<AdminCompanyView>> {
    return this.companies.adminList(query);
  }

  @HttpCode(HttpStatus.OK)
  @Post('companies/:id/hide')
  async hideCompany(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ): Promise<AdminCompanyView> {
    const view = await this.companies.hide(id, dto.reason);
    this.record(admin, 'company.hide', id, dto.reason);
    return view;
  }

  @HttpCode(HttpStatus.OK)
  @Post('companies/:id/restore')
  async restoreCompany(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
  ): Promise<AdminCompanyView> {
    const view = await this.companies.restore(id);
    this.record(admin, 'company.restore', id);
    return view;
  }

  @Post('skills')
  async createSkill(
    @CurrentUser() admin: AuthUser,
    @Body() dto: CreateSkillDto,
  ): Promise<SkillView> {
    const view = await this.skills.create(dto);
    this.record(admin, 'skill.create', view.id);
    return view;
  }

  @Patch('skills/:id')
  async updateSkill(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateSkillDto,
  ): Promise<SkillView> {
    const view = await this.skills.update(id, dto);
    this.record(admin, 'skill.update', id);
    return view;
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('skills/:id')
  async deleteSkill(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.skills.remove(id);
    this.record(admin, 'skill.delete', id);
  }

  // one structured log line per successful moderation action
  private record(
    admin: AuthUser,
    action: string,
    target: string,
    reason?: string,
  ): void {
    this.audit.log(
      `admin=${admin.id} action=${action} target=${target}${reason ? ` reason=${JSON.stringify(reason)}` : ''}`,
    );
  }
}
