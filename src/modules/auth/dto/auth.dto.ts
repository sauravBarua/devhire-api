import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
const nameSchema = z.string().trim().min(1).max(100);

export const registerSchema = z.object({
  email: emailSchema,
  // bcrypt only uses the first 72 bytes, so cap the length
  password: z.string().min(8).max(72),
  firstName: nameSchema,
  lastName: nameSchema,
  role: z.enum(['CANDIDATE', 'RECRUITER']),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72),
});

export class RegisterDto extends createZodDto(registerSchema) {}
export class LoginDto extends createZodDto(loginSchema) {}
