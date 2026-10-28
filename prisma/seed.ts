import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { PrismaClient } from '../src/generated/prisma/client';
import { Role } from '../src/generated/prisma/enums';
import { SKILLS } from '../src/modules/skills/skills.data';

const env = z
  .object({
    DATABASE_URL: z.url(),
    SEED_ADMIN_EMAIL: z.email(),
    SEED_ADMIN_PASSWORD: z.string().min(8).max(72),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  })
  .parse(process.env);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});

async function seedAdmin(): Promise<void> {
  const email = env.SEED_ADMIN_EMAIL.toLowerCase();
  const passwordHash = await bcrypt.hash(
    env.SEED_ADMIN_PASSWORD,
    env.BCRYPT_ROUNDS,
  );
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: Role.ADMIN },
    create: {
      email,
      passwordHash,
      firstName: 'Admin',
      lastName: 'DevHire',
      role: Role.ADMIN,
    },
  });
  console.log(`Seeded admin ${email}`);
}

async function seedSkills(): Promise<void> {
  for (const skill of SKILLS) {
    await prisma.skill.upsert({
      where: { slug: skill.slug },
      update: { name: skill.name, aliases: skill.aliases },
      create: skill,
    });
  }
  console.log(`Seeded ${SKILLS.length} skills`);
}

async function main(): Promise<void> {
  await seedAdmin();
  await seedSkills();
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
