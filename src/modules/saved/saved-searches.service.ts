import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import type { Prisma, SavedSearch } from '../../generated/prisma/client';
import type { AlertFrequency } from '../../generated/prisma/enums';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type {
  CreateSavedSearchDto,
  UpdateSavedSearchDto,
} from './dto/saved.dto';

export const MAX_SAVED_SEARCHES = 20;

export interface SavedSearchView {
  id: string;
  name: string;
  filters: unknown;
  frequency: AlertFrequency;
  alertsEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertableSearch {
  id: string;
  userId: string;
  frequency: AlertFrequency;
  filters: unknown;
}

function toView(row: SavedSearch): SavedSearchView {
  return {
    id: row.id,
    name: row.name,
    filters: row.filters,
    frequency: row.frequency,
    alertsEnabled: row.alertsEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// drops undefined values so the stored JSON only holds real criteria
function toJson(value: object): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

@Injectable()
export class SavedSearchesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    dto: CreateSavedSearchDto,
  ): Promise<SavedSearchView> {
    const count = await this.prisma.savedSearch.count({ where: { userId } });
    if (count >= MAX_SAVED_SEARCHES) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'SAVED_SEARCH_LIMIT',
        `You can save up to ${MAX_SAVED_SEARCHES} searches`,
        { limit: MAX_SAVED_SEARCHES },
      );
    }
    const row = await this.prisma.savedSearch.create({
      data: {
        userId,
        name: dto.name,
        filters: toJson(dto.filters),
        frequency: dto.frequency,
        alertsEnabled: dto.alertsEnabled,
      },
    });
    return toView(row);
  }

  async list(userId: string): Promise<SavedSearchView[]> {
    const rows = await this.prisma.savedSearch.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toView);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateSavedSearchDto,
  ): Promise<SavedSearchView> {
    await this.requireOwned(userId, id);
    const row = await this.prisma.savedSearch.update({
      where: { id },
      data: {
        name: dto.name,
        filters: dto.filters ? toJson(dto.filters) : undefined,
        frequency: dto.frequency,
        alertsEnabled: dto.alertsEnabled,
      },
    });
    return toView(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.prisma.savedSearch.deleteMany({
      where: { id, userId },
    });
    if (result.count === 0) throw this.notFound();
  }

  // public entry points for the alerts module

  // keyset-paginated so alerts can walk every enabled search in batches
  listAlertable(
    afterId: string | null,
    take: number,
  ): Promise<AlertableSearch[]> {
    return this.prisma.savedSearch.findMany({
      where: {
        alertsEnabled: true,
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: 'asc' },
      take,
      select: { id: true, userId: true, frequency: true, filters: true },
    });
  }

  findById(id: string): Promise<{
    id: string;
    userId: string;
    name: string;
    filters: unknown;
    alertsEnabled: boolean;
  } | null> {
    return this.prisma.savedSearch.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        name: true,
        filters: true,
        alertsEnabled: true,
      },
    });
  }

  private async requireOwned(userId: string, id: string): Promise<void> {
    const count = await this.prisma.savedSearch.count({
      where: { id, userId },
    });
    if (count === 0) throw this.notFound();
  }

  private notFound(): AppException {
    return new AppException(
      HttpStatus.NOT_FOUND,
      'SAVED_SEARCH_NOT_FOUND',
      'Saved search not found',
    );
  }
}
