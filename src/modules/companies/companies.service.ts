import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import { resolveImageMime } from '../../common/files/image-signature';
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
  createdAt: Date;
  updatedAt: Date;
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
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
  };
}

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
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

  // public entry point for other modules (jobs, applications)
  async findByOwnerId(ownerId: string): Promise<CompanyView | null> {
    const company = await this.findRowByOwner(ownerId);
    return company ? toView(company) : null;
  }

  // public entry point for other modules (public job views)
  async findByIds(ids: string[]): Promise<CompanyView[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.company.findMany({
      where: { id: { in: ids } },
    });
    return rows.map(toView);
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
    if (!company) throw this.notFound();
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
