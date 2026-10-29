import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { PublicJobView } from '../jobs/jobs.view';
import { PublicJobsService } from '../jobs/public-jobs.service';
import { searchQuerySchema, type SearchQuery } from './dto/search.dto';
import { SearchCacheService } from './search-cache.service';
import {
  decodeCursor,
  encodeCursor,
  makeExcerpt,
  normalizeFilters,
  type Cursor,
  type SearchFilters,
} from './search.utils';

export type PublicJobSummary = Omit<PublicJobView, 'description'> & {
  excerpt: string;
};

export interface FacetCount {
  value: string;
  count: number;
}

export interface SkillFacetCount extends FacetCount {
  label: string;
}

export interface SearchFacets {
  category: FacetCount[];
  contractType: FacetCount[];
  remotePolicy: FacetCount[];
  experienceLevel: FacetCount[];
  skills: SkillFacetCount[];
  cities: FacetCount[];
}

export interface SearchResult {
  items: PublicJobSummary[];
  nextCursor: string | null;
  // total and facets are only computed for the first page (no cursor)
  total: number | null;
  facets: SearchFacets | null;
}

type EnumDimension =
  'category' | 'contractType' | 'remotePolicy' | 'experienceLevel';
type Dimension = EnumDimension | 'skills' | 'city';

interface PageRow {
  id: string;
  publishedAt: Date;
  rank: number | null;
}

// timestamps are stored as UTC without a time zone, so compare against UTC now
const UTC_NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
const TS_CONFIG = 'public.devhire_fr';
const SKILL_FACET_LIMIT = 20;
const CITY_FACET_LIMIT = 10;

function toSummary(view: PublicJobView): PublicJobSummary {
  const { description, ...rest } = view;
  return { ...rest, excerpt: makeExcerpt(description) };
}

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: PublicJobsService,
    private readonly cache: SearchCacheService,
  ) {}

  async search(query: SearchQuery): Promise<SearchResult> {
    const filters = normalizeFilters(query);
    const slot = await this.cache.lookup({
      ...filters,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    if (slot.hit) return slot.hit;

    const result = await this.run(filters, query.limit, query.cursor);
    await slot.store(result);
    return result;
  }

  // Does a single job match stored search criteria? Used to build alerts for new jobs.
  async matchesJob(storedFilters: unknown, jobId: string): Promise<boolean> {
    const parsed = searchQuerySchema.safeParse(storedFilters);
    if (!parsed.success) return false;
    const filters = normalizeFilters(parsed.data);
    const rows = await this.prisma.$queryRaw<Array<{ ok: number }>>(
      Prisma.sql`SELECT 1 AS "ok" FROM "Job" j WHERE ${this.where(filters)} AND j."id" = ${jobId}::text LIMIT 1`,
    );
    return rows.length > 0;
  }

  private async run(
    f: SearchFilters,
    limit: number,
    cursorToken?: string,
  ): Promise<SearchResult> {
    const cursor = cursorToken ? decodeCursor(cursorToken, f.sort) : null;
    const rows = await this.findPage(f, cursor, limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const views = await this.jobs.findPublicByIds(page.map((row) => row.id));
    const items = views.map(toSummary);

    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            sort: f.sort,
            rank: f.sort === 'relevance' ? Number(last.rank) : null,
            publishedAt: last.publishedAt.toISOString(),
            id: last.id,
          })
        : null;

    if (cursor) return { items, nextCursor, total: null, facets: null };

    const [total, facets] = await Promise.all([this.count(f), this.facets(f)]);
    return { items, nextCursor, total, facets };
  }

  private findPage(
    f: SearchFilters,
    cursor: Cursor | null,
    take: number,
  ): Promise<PageRow[]> {
    const where = this.where(f);

    if (f.sort === 'relevance' && f.q !== null) {
      const after = cursor
        ? Prisma.sql`WHERE (t."rank", t."publishedAt", t."id") < (${cursor.rank}::float8, ${cursor.publishedAt}::timestamp, ${cursor.id}::text)`
        : Prisma.empty;
      return this.prisma.$queryRaw<PageRow[]>(Prisma.sql`
        SELECT t."id", t."publishedAt", t."rank"
        FROM (
          SELECT j."id", j."publishedAt",
                 ts_rank_cd(j."searchVector", websearch_to_tsquery(${TS_CONFIG}::regconfig, ${f.q}::text))::float8 AS "rank"
          FROM "Job" j
          WHERE ${where}
        ) t
        ${after}
        ORDER BY t."rank" DESC, t."publishedAt" DESC, t."id" DESC
        LIMIT ${take}`);
    }

    const after = cursor
      ? Prisma.sql`AND (j."publishedAt", j."id") < (${cursor.publishedAt}::timestamp, ${cursor.id}::text)`
      : Prisma.empty;
    return this.prisma.$queryRaw<PageRow[]>(Prisma.sql`
      SELECT j."id", j."publishedAt", NULL::float8 AS "rank"
      FROM "Job" j
      WHERE ${where} ${after}
      ORDER BY j."publishedAt" DESC, j."id" DESC
      LIMIT ${take}`);
  }

  private async count(f: SearchFilters): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ count: number }>>(
      Prisma.sql`SELECT count(*)::int AS "count" FROM "Job" j WHERE ${this.where(f)}`,
    );
    return rows[0]?.count ?? 0;
  }

  // each facet is counted with every filter EXCEPT its own, so users can still switch values
  private async facets(f: SearchFilters): Promise<SearchFacets> {
    const [
      category,
      contractType,
      remotePolicy,
      experienceLevel,
      skills,
      cities,
    ] = await Promise.all([
      this.enumFacet(f, 'category'),
      this.enumFacet(f, 'contractType'),
      this.enumFacet(f, 'remotePolicy'),
      this.enumFacet(f, 'experienceLevel'),
      this.skillFacet(f),
      this.cityFacet(f),
    ]);
    return {
      category,
      contractType,
      remotePolicy,
      experienceLevel,
      skills,
      cities,
    };
  }

  private enumFacet(
    f: SearchFilters,
    dimension: EnumDimension,
  ): Promise<FacetCount[]> {
    // the column name comes from a fixed union, never from user input
    const column = Prisma.raw(`j."${dimension}"::text`);
    return this.prisma.$queryRaw<FacetCount[]>(Prisma.sql`
      SELECT ${column} AS "value", count(*)::int AS "count"
      FROM "Job" j
      WHERE ${this.where(f, dimension)}
      GROUP BY 1
      ORDER BY "count" DESC, "value" ASC`);
  }

  private skillFacet(f: SearchFilters): Promise<SkillFacetCount[]> {
    return this.prisma.$queryRaw<SkillFacetCount[]>(Prisma.sql`
      SELECT s."slug" AS "value", s."name" AS "label", count(*)::int AS "count"
      FROM "Job" j
      JOIN "JobSkill" js ON js."jobId" = j."id"
      JOIN "Skill" s ON s."id" = js."skillId"
      WHERE ${this.where(f, 'skills')}
      GROUP BY s."slug", s."name"
      ORDER BY "count" DESC, s."name" ASC
      LIMIT ${SKILL_FACET_LIMIT}`);
  }

  private cityFacet(f: SearchFilters): Promise<FacetCount[]> {
    return this.prisma.$queryRaw<FacetCount[]>(Prisma.sql`
      SELECT j."city" AS "value", count(*)::int AS "count"
      FROM "Job" j
      WHERE ${this.where(f, 'city')} AND j."city" IS NOT NULL
      GROUP BY j."city"
      ORDER BY "count" DESC, j."city" ASC
      LIMIT ${CITY_FACET_LIMIT}`);
  }

  private where(f: SearchFilters, exclude?: Dimension): Prisma.Sql {
    return Prisma.join(this.conditions(f, exclude), ' AND ');
  }

  private conditions(f: SearchFilters, exclude?: Dimension): Prisma.Sql[] {
    // only live jobs are searchable, even if the expiry task has not moved them to EXPIRED yet
    const conditions: Prisma.Sql[] = [
      Prisma.sql`j."status" = 'PUBLISHED'`,
      Prisma.sql`j."expiresAt" > ${UTC_NOW}`,
      // jobs of a company hidden by a moderator never appear, in results, totals, facets or alerts
      Prisma.sql`NOT EXISTS (SELECT 1 FROM "Company" hc WHERE hc."id" = j."companyId" AND hc."hiddenAt" IS NOT NULL)`,
    ];

    // websearch_to_tsquery ANDs the terms, so every term must match
    if (f.q !== null) {
      conditions.push(
        Prisma.sql`j."searchVector" @@ websearch_to_tsquery(${TS_CONFIG}::regconfig, ${f.q}::text)`,
      );
    }
    if (exclude !== 'category' && f.category.length > 0) {
      conditions.push(
        Prisma.sql`j."category"::text IN (${Prisma.join(f.category)})`,
      );
    }
    if (exclude !== 'contractType' && f.contractType.length > 0) {
      conditions.push(
        Prisma.sql`j."contractType"::text IN (${Prisma.join(f.contractType)})`,
      );
    }
    if (exclude !== 'remotePolicy' && f.remotePolicy.length > 0) {
      conditions.push(
        Prisma.sql`j."remotePolicy"::text IN (${Prisma.join(f.remotePolicy)})`,
      );
    }
    if (exclude !== 'experienceLevel' && f.experienceLevel.length > 0) {
      conditions.push(
        Prisma.sql`j."experienceLevel"::text IN (${Prisma.join(f.experienceLevel)})`,
      );
    }
    // "all of" semantics on exact skill slugs, never on text
    if (exclude !== 'skills' && f.skills.length > 0) {
      conditions.push(Prisma.sql`(
        SELECT count(DISTINCT s."slug")
        FROM "JobSkill" js
        JOIN "Skill" s ON s."id" = js."skillId"
        WHERE js."jobId" = j."id" AND s."slug" IN (${Prisma.join(f.skills)})
      ) = ${f.skills.length}`);
    }
    if (exclude !== 'city' && f.city !== null) {
      conditions.push(
        Prisma.sql`lower(public.unaccent(j."city")) = lower(public.unaccent(${f.city}::text))`,
      );
    }
    if (f.region !== null) {
      conditions.push(
        Prisma.sql`lower(public.unaccent(j."region")) = lower(public.unaccent(${f.region}::text))`,
      );
    }
    // salary: the job range must overlap the requested range; a one-sided job range counts as a point
    if (f.salaryMin !== null) {
      conditions.push(
        Prisma.sql`COALESCE(j."salaryMax", j."salaryMin") >= ${f.salaryMin}`,
      );
    }
    if (f.salaryMax !== null) {
      conditions.push(
        Prisma.sql`COALESCE(j."salaryMin", j."salaryMax") <= ${f.salaryMax}`,
      );
    }
    if (f.postedHours !== null) {
      conditions.push(
        Prisma.sql`j."publishedAt" >= ${UTC_NOW} - make_interval(hours => ${f.postedHours}::int)`,
      );
    }
    return conditions;
  }
}
