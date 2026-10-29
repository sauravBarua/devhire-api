import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppException } from '../../common/errors/app.exception';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import {
  DomainEvents,
  type CompanyEventName,
  type CompanyEventPayload,
} from '../../common/events/domain-events';
import { resolveImageMime } from '../../common/files/image-signature';
import type { CursorPage } from '../../common/types/cursor-page';
import { slugify } from '../../common/utils/slugify';
import type { Company } from '../../generated/prisma/client';
import { CloudinaryService } from '../../infra/cloudinary/cloudinary.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

export interface CompanyView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  website: string | null;
  city: string | null;
  logoUrl: string | null;
  // always false on public pages (a hidden company is a 404); the owner sees the real value
  isHidden: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminCompanyView extends CompanyView {
  ownerId: string;
  hiddenAt: Date | null;
  hiddenReason: string | null;
}

export interface CompanySummary {
  id: string;
  slug: string;
  name: string;
  isHidden: boolean;
}

export interface AdminCompaniesQuery {
  hidden?: boolean;
  q?: string;
  limit: number;
  cursor?: string;
}

const LOGO_FOLDER = 'devhire/logos';
// "me" is a route (/companies/me), so it can never be a company slug
const RESERVED_SLUGS = new Set(['me']);

function toView(company: Company): CompanyView {
  return {
    id: company.id,
    slug: company.slug,
    name: company.name,
    description: company.description,
    website: company.website,
    city: company.city,
    logoUrl: company.logoUrl,
    isHidden: company.hiddenAt !== null,
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
  };
}

function toAdminView(company: Company): AdminCompanyView {
  return {
    ...toView(company),
    ownerId: company.ownerId,
    hiddenAt: company.hiddenAt,
    hiddenReason: company.hiddenReason,
  };
}

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly events: EventEmitter2,
  ) {}

  async create(ownerId: string, dto: CreateCompanyDto): Promise<CompanyView> {
    if (await this.findRowByOwner(ownerId)) throw this.alreadyExists();

    const slug = await this.uniqueSlug(dto.name);
    try {
      const company = await this.prisma.company.create({
        data: {
          ownerId,
          slug,
          name: dto.name,
          description: dto.description,
          website: dto.website,
          city: dto.city,
        },
      });
      return toView(company);
    } catch (error) {
      if (isUniqueViolation(error)) {
        if (await this.findRowByOwner(ownerId)) throw this.alreadyExists();
        throw new AppException(
          HttpStatus.CONFLICT,
          'COMPANY_CONFLICT',
          'Company could not be created, please retry',
        );
      }
      throw error;
    }
  }

  // public entry point for other modules (jobs, applications); includes hidden companies
  async findByOwnerId(ownerId: string): Promise<CompanyView | null> {
    const company = await this.findRowByOwner(ownerId);
    return company ? toView(company) : null;
  }

  // public entry point for other modules (public job views); hidden companies are left out,
  // which is what removes their jobs from every public view
  async findByIds(ids: string[]): Promise<CompanyView[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.company.findMany({
      where: { id: { in: ids }, hiddenAt: null },
    });
    return rows.map(toView);
  }

  // public entry point for the admin area; includes hidden companies
  async findSummariesByIds(ids: string[]): Promise<CompanySummary[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.company.findMany({
      where: { id: { in: ids } },
      select: { id: true, slug: true, name: true, hiddenAt: true },
    });
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      isHidden: row.hiddenAt !== null,
    }));
  }

  // public entry point for other modules (notifications): who owns this company?
  async findOwnerId(companyId: string): Promise<string | null> {
    const row = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { ownerId: true },
    });
    return row?.ownerId ?? null;
  }

  async getOwn(ownerId: string): Promise<CompanyView> {
    return toView(await this.requireOwned(ownerId));
  }

  async updateOwn(
    ownerId: string,
    dto: UpdateCompanyDto,
  ): Promise<CompanyView> {
    const company = await this.requireOwned(ownerId);
    const updated = await this.prisma.company.update({
      where: { id: company.id },
      data: {
        name: dto.name,
        description: dto.description,
        website: dto.website,
        city: dto.city,
      },
    });
    return toView(updated);
  }

  async getBySlug(slug: string): Promise<CompanyView> {
    const company = await this.prisma.company.findUnique({ where: { slug } });
    if (!company || company.hiddenAt !== null) throw this.notFound();
    return toView(company);
  }

  async setLogo(
    ownerId: string,
    file: Express.Multer.File | undefined,
  ): Promise<CompanyView> {
    if (!file) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'FILE_REQUIRED',
        'A file is required in the "file" field',
      );
    }
    const mime = resolveImageMime(file.mimetype, file.buffer);
    if (!mime) {
      throw new AppException(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'FILE_INVALID_TYPE',
        'Logo must be a PNG, JPEG or WebP image',
      );
    }

    // check ownership before uploading so a failed request leaves no orphan file
    const company = await this.requireOwned(ownerId);
    const stored = await this.cloudinary.uploadImage(
      file.buffer,
      mime,
      LOGO_FOLDER,
    );
    const updated = await this.prisma.company.update({
      where: { id: company.id },
      data: {
        logoPublicId: stored.publicId,
        logoUrl: stored.secureUrl,
        logoSize: stored.size,
        logoMime: stored.mime,
      },
    });
    if (company.logoPublicId)
      await this.cloudinary.destroy(company.logoPublicId);
    return toView(updated);
  }

  // moderation

  async adminList(
    query: AdminCompaniesQuery,
  ): Promise<CursorPage<AdminCompanyView>> {
    const hiddenFilter =
      query.hidden === undefined
        ? undefined
        : query.hidden
          ? { not: null }
          : null;
    const rows = await this.prisma.company.findMany({
      where: {
        hiddenAt: hiddenFilter,
        name: query.q ? { contains: query.q, mode: 'insensitive' } : undefined,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: page.map(toAdminView),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // hiding keeps the company and its jobs; they just stop being visible and usable
  async hide(companyId: string, reason: string): Promise<AdminCompanyView> {
    const now = new Date();
    const result = await this.prisma.company.updateMany({
      where: { id: companyId, hiddenAt: null },
      data: { hiddenAt: now, hiddenReason: reason },
    });
    if (result.count === 0) {
      await this.requireExists(companyId);
      throw new AppException(
        HttpStatus.CONFLICT,
        'COMPANY_ALREADY_HIDDEN',
        'Company is already hidden',
      );
    }
    this.emit(DomainEvents.CompanyHidden, companyId, now);
    return toAdminView(
      await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
    );
  }

  async restore(companyId: string): Promise<AdminCompanyView> {
    const now = new Date();
    const result = await this.prisma.company.updateMany({
      where: { id: companyId, hiddenAt: { not: null } },
      data: { hiddenAt: null, hiddenReason: null },
    });
    if (result.count === 0) {
      await this.requireExists(companyId);
      throw new AppException(
        HttpStatus.CONFLICT,
        'COMPANY_NOT_HIDDEN',
        'Company is not hidden',
      );
    }
    this.emit(DomainEvents.CompanyRestored, companyId, now);
    return toAdminView(
      await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
    );
  }

  private emit(
    name: CompanyEventName,
    companyId: string,
    occurredAt: Date,
  ): void {
    const payload: CompanyEventPayload = { companyId, occurredAt };
    this.events.emit(name, payload);
  }

  private async requireExists(companyId: string): Promise<void> {
    const count = await this.prisma.company.count({ where: { id: companyId } });
    if (count === 0) throw this.notFound();
  }

  private findRowByOwner(ownerId: string): Promise<Company | null> {
    return this.prisma.company.findUnique({ where: { ownerId } });
  }

  private async requireOwned(ownerId: string): Promise<Company> {
    const company = await this.findRowByOwner(ownerId);
    if (!company) throw this.notFound();
    return company;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    let candidate = base;
    let suffix = 1;
    while (
      RESERVED_SLUGS.has(candidate) ||
      (await this.prisma.company.findUnique({
        where: { slug: candidate },
        select: { id: true },
      }))
    ) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  }

  private alreadyExists(): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      'COMPANY_ALREADY_EXISTS',
      'This recruiter already has a company',
    );
  }

  private notFound(): AppException {
    return new AppException(
      HttpStatus.NOT_FOUND,
      'COMPANY_NOT_FOUND',
      'Company not found',
    );
  }
}
