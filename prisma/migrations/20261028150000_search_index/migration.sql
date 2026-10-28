-- Accent-insensitive French text search configuration.
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TEXT SEARCH CONFIGURATION public.devhire_fr (COPY = pg_catalog.french);
ALTER TEXT SEARCH CONFIGURATION public.devhire_fr
  ALTER MAPPING FOR asciiword, asciihword, hword_asciipart, hword, hword_part, word
  WITH unaccent, french_stem;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "searchVector" tsvector;

-- Builds the weighted vector: title A > skills (name + aliases) B > company name / city / region C > description D.
CREATE FUNCTION job_compute_search_vector(
  p_job_id text,
  p_company_id text,
  p_title text,
  p_description text,
  p_city text,
  p_region text
) RETURNS tsvector
LANGUAGE sql STABLE AS $$
  SELECT
    setweight(to_tsvector('public.devhire_fr', coalesce(p_title, '')), 'A') ||
    setweight(to_tsvector('public.devhire_fr', coalesce((
      SELECT string_agg(s."name" || ' ' || array_to_string(s."aliases", ' '), ' ')
      FROM "JobSkill" js
      JOIN "Skill" s ON s."id" = js."skillId"
      WHERE js."jobId" = p_job_id
    ), '')), 'B') ||
    setweight(to_tsvector('public.devhire_fr',
      coalesce((SELECT c."name" FROM "Company" c WHERE c."id" = p_company_id), '') || ' ' ||
      coalesce(p_city, '') || ' ' || coalesce(p_region, '')), 'C') ||
    setweight(to_tsvector('public.devhire_fr', coalesce(p_description, '')), 'D')
$$;

-- Job insert / relevant column update: compute from the row itself.
CREATE FUNCTION job_search_vector_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchVector" := job_compute_search_vector(
    NEW."id", NEW."companyId", NEW."title", NEW."description", NEW."city", NEW."region"
  );
  RETURN NEW;
END
$$;

CREATE TRIGGER job_search_vector_biu
BEFORE INSERT OR UPDATE OF "title", "description", "city", "region", "companyId" ON "Job"
FOR EACH ROW EXECUTE FUNCTION job_search_vector_trigger();

-- Skills attached or detached from a job: refresh that job.
CREATE FUNCTION job_skill_search_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_job_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_job_id := OLD."jobId";
  ELSE
    v_job_id := NEW."jobId";
  END IF;
  UPDATE "Job" j
  SET "searchVector" = job_compute_search_vector(
    j."id", j."companyId", j."title", j."description", j."city", j."region"
  )
  WHERE j."id" = v_job_id;
  RETURN NULL;
END
$$;

CREATE TRIGGER job_skill_search_aid
AFTER INSERT OR DELETE ON "JobSkill"
FOR EACH ROW EXECUTE FUNCTION job_skill_search_trigger();

-- Company renamed: refresh all its jobs.
CREATE FUNCTION company_search_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Job" j
  SET "searchVector" = job_compute_search_vector(
    j."id", j."companyId", j."title", j."description", j."city", j."region"
  )
  WHERE j."companyId" = NEW."id";
  RETURN NULL;
END
$$;

CREATE TRIGGER company_search_au
AFTER UPDATE OF "name" ON "Company"
FOR EACH ROW WHEN (OLD."name" IS DISTINCT FROM NEW."name")
EXECUTE FUNCTION company_search_trigger();

-- Skill renamed or aliases changed: refresh the jobs that use it.
CREATE FUNCTION skill_search_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Job" j
  SET "searchVector" = job_compute_search_vector(
    j."id", j."companyId", j."title", j."description", j."city", j."region"
  )
  FROM "JobSkill" js
  WHERE js."jobId" = j."id" AND js."skillId" = NEW."id";
  RETURN NULL;
END
$$;

CREATE TRIGGER skill_search_au
AFTER UPDATE OF "name", "aliases" ON "Skill"
FOR EACH ROW WHEN (OLD."name" IS DISTINCT FROM NEW."name" OR OLD."aliases" IS DISTINCT FROM NEW."aliases")
EXECUTE FUNCTION skill_search_trigger();

-- CreateIndex
CREATE INDEX "Job_searchVector_idx" ON "Job" USING GIN ("searchVector");

-- Backfill existing rows.
UPDATE "Job" j
SET "searchVector" = job_compute_search_vector(
  j."id", j."companyId", j."title", j."description", j."city", j."region"
);
