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
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { Role } from '../../generated/prisma/enums';
import { CreateSavedSearchDto, UpdateSavedSearchDto } from './dto/saved.dto';
import {
  SavedSearchesService,
  type SavedSearchView,
} from './saved-searches.service';

@Roles(Role.CANDIDATE)
@Controller('saved-searches')
export class SavedSearchesController {
  constructor(private readonly savedSearches: SavedSearchesService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSavedSearchDto,
  ): Promise<SavedSearchView> {
    return this.savedSearches.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<SavedSearchView[]> {
    return this.savedSearches.list(user.id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateSavedSearchDto,
  ): Promise<SavedSearchView> {
    return this.savedSearches.update(user.id, id, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.savedSearches.remove(user.id, id);
  }
}
