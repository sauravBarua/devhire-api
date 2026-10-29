import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { normalizeAliases } from '../skills.rules';

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(50)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'slug must be lowercase letters, digits and single dashes',
  );
const name = z.string().trim().min(1).max(60);
const aliasList = z
  .array(z.string().trim().toLowerCase().min(1).max(50))
  .max(20);

export const createSkillSchema = z.object({
  slug,
  name,
  aliases: aliasList.default([]).transform(normalizeAliases),
});

// the slug never changes: it is stored in saved searches and used in filters
export const updateSkillSchema = z.object({
  name: name.optional(),
  aliases: aliasList.transform(normalizeAliases).optional(),
});

export class CreateSkillDto extends createZodDto(createSkillSchema) {}
export class UpdateSkillDto extends createZodDto(updateSkillSchema) {}
