-- Include each skill's slug in the weighted vector (B), so "nodejs" matches the Node.js skill.
CREATE OR REPLACE FUNCTION job_compute_search_vector(
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
      SELECT string_agg(s."slug" || ' ' || s."name" || ' ' || array_to_string(s."aliases", ' '), ' ')
      FROM "JobSkill" js
      JOIN "Skill" s ON s."id" = js."skillId"
      WHERE js."jobId" = p_job_id
    ), '')), 'B') ||
    setweight(to_tsvector('public.devhire_fr',
      coalesce((SELECT c."name" FROM "Company" c WHERE c."id" = p_company_id), '') || ' ' ||
      coalesce(p_city, '') || ' ' || coalesce(p_region, '')), 'C') ||
    setweight(to_tsvector('public.devhire_fr', coalesce(p_description, '')), 'D')
$$;

-- Refresh existing rows with the new definition.
UPDATE "Job" j
SET "searchVector" = job_compute_search_vector(
  j."id", j."companyId", j."title", j."description", j."city", j."region"
);
