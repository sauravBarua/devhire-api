import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const nameSchema = z.string().trim().min(2).max(100);
const descriptionSchema = z.string().trim().max(5000);
const citySchema = z.string().trim().min(1).max(100);
const websiteSchema = z
  .string()
  .trim()
  .max(255)
  .pipe(z.url({ protocol: /^https?$/ }));

export const createCompanySchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  website: websiteSchema.optional(),
  city: citySchema.optional(),
});

// null clears an optional field, omitting a field leaves it unchanged
export const updateCompanySchema = z.object({
  name: nameSchema.optional(),
  description: descriptionSchema.nullable().optional(),
  website: websiteSchema.nullable().optional(),
  city: citySchema.nullable().optional(),
});

export class CreateCompanyDto extends createZodDto(createCompanySchema) {}
export class UpdateCompanyDto extends createZodDto(updateCompanySchema) {}
