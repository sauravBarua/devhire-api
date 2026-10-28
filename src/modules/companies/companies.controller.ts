import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { Role } from '../../generated/prisma/enums';
import { CompaniesService, type CompanyView } from './companies.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Roles(Role.RECRUITER)
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCompanyDto,
  ): Promise<CompanyView> {
    return this.companies.create(user.id, dto);
  }

  // declared before ':slug' so "me" is never read as a slug
  @Roles(Role.RECRUITER)
  @Get('me')
  getOwn(@CurrentUser() user: AuthUser): Promise<CompanyView> {
    return this.companies.getOwn(user.id);
  }

  @Roles(Role.RECRUITER)
  @Patch('me')
  updateOwn(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateCompanyDto,
  ): Promise<CompanyView> {
    return this.companies.updateOwn(user.id, dto);
  }

  @Roles(Role.RECRUITER)
  @HttpCode(HttpStatus.OK)
  @Post('me/logo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_LOGO_BYTES, files: 1 },
    }),
  )
  uploadLogo(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<CompanyView> {
    return this.companies.setLogo(user.id, file);
  }

  @Public()
  @Get(':slug')
  getBySlug(@Param('slug') slug: string): Promise<CompanyView> {
    return this.companies.getBySlug(slug);
  }
}
