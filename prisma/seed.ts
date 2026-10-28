import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { slugify } from '../src/common/utils/slugify';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  ContractType,
  ExperienceLevel,
  JobCategory,
  JobStatus,
  RemotePolicy,
  Role,
} from '../src/generated/prisma/enums';
import { SKILLS } from '../src/modules/skills/skills.data';

const env = z
  .object({
    DATABASE_URL: z.url(),
    SEED_ADMIN_EMAIL: z.email(),
    SEED_ADMIN_PASSWORD: z.string().min(8).max(72),
    // password shared by the demo recruiter accounts (recruiter01@devhire.test ... recruiter15@devhire.test)
    SEED_USER_PASSWORD: z.string().min(8).max(72).default('Passw0rd!dev'),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  })
  .parse(process.env);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// All companies below are fictional; any resemblance to a real company is unintentional.
const PLACES = [
  { city: 'Paris', region: 'Île-de-France' },
  { city: 'Lyon', region: 'Auvergne-Rhône-Alpes' },
  { city: 'Lille', region: 'Hauts-de-France' },
  { city: 'Nantes', region: 'Pays de la Loire' },
  { city: 'Bordeaux', region: 'Nouvelle-Aquitaine' },
  { city: 'Toulouse', region: 'Occitanie' },
  { city: 'Marseille', region: "Provence-Alpes-Côte d'Azur" },
  { city: 'Rennes', region: 'Bretagne' },
  { city: 'Montpellier', region: 'Occitanie' },
  { city: 'Strasbourg', region: 'Grand Est' },
];

const COMPANIES = [
  {
    name: 'Kodalis',
    place: 0,
    description: 'Éditeur de logiciels de gestion pour les PME.',
  },
  {
    name: 'Nexaweb',
    place: 1,
    description: 'Agence web spécialisée dans les plateformes e-commerce.',
  },
  {
    name: 'Octobre Logiciel',
    place: 2,
    description: 'Studio de développement de produits SaaS.',
  },
  {
    name: 'Atelier Pixel',
    place: 3,
    description: "Atelier de design et d'intégration front-end.",
  },
  {
    name: 'Studio Cadence',
    place: 4,
    description: "Conception d'applications métier sur mesure.",
  },
  {
    name: 'Orbitale',
    place: 0,
    description: 'Plateforme de logistique et de suivi de flotte.',
  },
  {
    name: 'Fabrique Numérique',
    place: 5,
    description: 'Transformation numérique pour les collectivités.',
  },
  {
    name: 'Helios Données',
    place: 6,
    description: "Solutions d'analyse et de visualisation de données.",
  },
  {
    name: 'Lanterne Tech',
    place: 7,
    description: "Outils de productivité pour les équipes d'ingénierie.",
  },
  {
    name: 'Tramontane Soft',
    place: 8,
    description: 'Logiciels pour le tourisme et la réservation en ligne.',
  },
  {
    name: 'Quai Numérique',
    place: 9,
    description: 'Services cloud et hébergement pour le secteur industriel.',
  },
  {
    name: 'Boréal Systèmes',
    place: 0,
    description: 'Infrastructure et sécurité pour les services financiers.',
  },
  {
    name: 'Cobalt Atelier',
    place: 1,
    description: 'Applications mobiles et web pour la santé.',
  },
  {
    name: 'Maraude Tech',
    place: 3,
    description: 'Technologies solidaires et applications associatives.',
  },
  {
    name: 'Sillage Digital',
    place: 0,
    description: 'Marketplace de services entre professionnels.',
  },
];

interface Template {
  title: string;
  category: JobCategory;
  skills: string[];
}

const TEMPLATES: Template[] = [
  {
    title: 'Développeur Frontend React',
    category: JobCategory.FRONTEND,
    skills: ['react', 'typescript', 'css', 'html'],
  },
  {
    title: 'Développeur Next.js',
    category: JobCategory.FRONTEND,
    skills: ['nextjs', 'react', 'typescript', 'tailwindcss'],
  },
  {
    title: 'Développeur Vue.js',
    category: JobCategory.FRONTEND,
    skills: ['vuejs', 'javascript', 'css'],
  },
  {
    title: 'Développeur Angular',
    category: JobCategory.FRONTEND,
    skills: ['angular', 'typescript'],
  },
  {
    title: 'Développeur Backend Node.js',
    category: JobCategory.BACKEND,
    skills: ['nodejs', 'typescript', 'postgresql'],
  },
  {
    title: 'Développeur NestJS',
    category: JobCategory.BACKEND,
    skills: ['nestjs', 'typescript', 'postgresql', 'docker'],
  },
  {
    title: 'Développeur PHP Laravel',
    category: JobCategory.BACKEND,
    skills: ['php', 'laravel', 'mysql'],
  },
  {
    title: 'Développeur Symfony',
    category: JobCategory.BACKEND,
    skills: ['php', 'symfony', 'mysql'],
  },
  {
    title: 'Développeur Python Django',
    category: JobCategory.BACKEND,
    skills: ['python', 'django', 'postgresql'],
  },
  {
    title: 'Développeur Java Spring',
    category: JobCategory.BACKEND,
    skills: ['java', 'spring', 'postgresql'],
  },
  {
    title: 'Développeur .NET',
    category: JobCategory.BACKEND,
    skills: ['dotnet', 'csharp'],
  },
  {
    title: 'Développeur Go',
    category: JobCategory.BACKEND,
    skills: ['go', 'docker', 'postgresql'],
  },
  {
    title: 'Développeur Fullstack TypeScript',
    category: JobCategory.FULLSTACK,
    skills: ['typescript', 'react', 'nodejs'],
  },
  {
    title: 'Développeur Fullstack Next.js / NestJS',
    category: JobCategory.FULLSTACK,
    skills: ['nextjs', 'nestjs', 'typescript', 'postgresql'],
  },
  {
    title: 'Développeur Fullstack Laravel / Vue',
    category: JobCategory.FULLSTACK,
    skills: ['laravel', 'vuejs', 'php'],
  },
  {
    title: 'Ingénieur DevOps',
    category: JobCategory.DEVOPS,
    skills: ['docker', 'kubernetes', 'aws', 'ci-cd'],
  },
  {
    title: 'Ingénieur Cloud SRE',
    category: JobCategory.DEVOPS,
    skills: ['kubernetes', 'aws', 'git'],
  },
  {
    title: 'Ingénieur QA Automation',
    category: JobCategory.QA,
    skills: ['playwright', 'cypress', 'typescript'],
  },
  {
    title: 'Testeur QA',
    category: JobCategory.QA,
    skills: ['jest', 'cypress'],
  },
  {
    title: 'Développeur Mobile React Native',
    category: JobCategory.MOBILE,
    skills: ['react-native', 'typescript'],
  },
  {
    title: 'Développeur Ruby on Rails',
    category: JobCategory.BACKEND,
    skills: ['ruby-on-rails', 'postgresql'],
  },
  {
    title: 'Développeur GraphQL',
    category: JobCategory.BACKEND,
    skills: ['graphql', 'nodejs', 'typescript'],
  },
];

const LEVELS = [
  { level: ExperienceLevel.JUNIOR, label: 'junior', salary: [32000, 40000] },
  { level: ExperienceLevel.MID, label: 'confirmé', salary: [40000, 55000] },
  { level: ExperienceLevel.SENIOR, label: 'senior', salary: [55000, 75000] },
] as const;

const CONTRACTS = [
  ContractType.CDI,
  ContractType.CDI,
  ContractType.CDI,
  ContractType.CDI,
  ContractType.CDD,
  ContractType.STAGE,
  ContractType.ALTERNANCE,
  ContractType.FREELANCE,
];

const REMOTES = [
  RemotePolicy.HYBRID,
  RemotePolicy.FULL_REMOTE,
  RemotePolicy.ON_SITE,
  RemotePolicy.HYBRID,
  RemotePolicy.HYBRID,
  RemotePolicy.FULL_REMOTE,
];

const TOTAL_JOBS = 80;

interface Lifecycle {
  status: JobStatus;
  publishedAt: Date | null;
  expiresAt: Date | null;
  closedAt: Date | null;
}

// 0-57 live (a few expire within 3 days), 58-60 PUBLISHED but already past expiresAt (for the expiry task),
// 61-66 DRAFT, 67-72 CLOSED, 73-79 EXPIRED with old dates.
function lifecycleFor(index: number, now: Date): Lifecycle {
  const ago = (days: number, hours = 0): Date =>
    new Date(now.getTime() - days * DAY_MS - hours * HOUR_MS);
  const ahead = (days: number): Date => new Date(now.getTime() + days * DAY_MS);

  if (index < 58) {
    const publishedAt = ago(index % 28, index % 24);
    return {
      status: JobStatus.PUBLISHED,
      publishedAt,
      expiresAt: new Date(publishedAt.getTime() + 30 * DAY_MS),
      closedAt: null,
    };
  }
  if (index < 61) {
    return {
      status: JobStatus.PUBLISHED,
      publishedAt: ago(40),
      expiresAt: ago(10),
      closedAt: null,
    };
  }
  if (index < 67) {
    return {
      status: JobStatus.DRAFT,
      publishedAt: null,
      expiresAt: null,
      closedAt: null,
    };
  }
  if (index < 73) {
    return {
      status: JobStatus.CLOSED,
      publishedAt: ago(20),
      expiresAt: ahead(10),
      closedAt: ago(5),
    };
  }
  const publishedAt = ago(50 + (index - 73));
  const expiresAt = new Date(publishedAt.getTime() + 30 * DAY_MS);
  return {
    status: JobStatus.EXPIRED,
    publishedAt,
    expiresAt,
    closedAt: expiresAt,
  };
}

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

async function seedSkills(): Promise<Map<string, string>> {
  for (const skill of SKILLS) {
    await prisma.skill.upsert({
      where: { slug: skill.slug },
      update: { name: skill.name, aliases: skill.aliases },
      create: skill,
    });
  }
  const rows = await prisma.skill.findMany({
    select: { id: true, slug: true },
  });
  console.log(`Seeded ${SKILLS.length} skills`);
  return new Map(rows.map((row) => [row.slug, row.id]));
}

async function seedCompaniesAndJobs(
  skillIdBySlug: Map<string, string>,
): Promise<void> {
  const passwordHash = await bcrypt.hash(
    env.SEED_USER_PASSWORD,
    env.BCRYPT_ROUNDS,
  );
  const skillNameBySlug = new Map(
    SKILLS.map((skill) => [skill.slug, skill.name]),
  );

  const companies: Array<{
    id: string;
    name: string;
    place: (typeof PLACES)[number];
  }> = [];
  for (const [index, entry] of COMPANIES.entries()) {
    const place = PLACES[entry.place];
    const email = `recruiter${String(index + 1).padStart(2, '0')}@devhire.test`;
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        passwordHash,
        firstName: 'Recruteur',
        lastName: entry.name,
        role: Role.RECRUITER,
      },
    });
    const slug = slugify(entry.name);
    const data = {
      name: entry.name,
      description: entry.description,
      city: place.city,
      website: `https://${slug}.example.com`,
    };
    const company = await prisma.company.upsert({
      where: { slug },
      update: data,
      create: { ownerId: user.id, slug, ...data },
    });
    companies.push({ id: company.id, name: company.name, place });
  }
  console.log(`Seeded ${companies.length} companies with recruiter accounts`);

  // re-running the seed resets the demo jobs of the seeded companies
  await prisma.job.deleteMany({
    where: { companyId: { in: companies.map((c) => c.id) } },
  });

  const now = new Date();
  for (let i = 0; i < TOTAL_JOBS; i += 1) {
    const template = TEMPLATES[(i * 5) % TEMPLATES.length];
    const company = companies[i % companies.length];
    const contractType = CONTRACTS[(i * 3) % CONTRACTS.length];
    const entryLevel =
      contractType === ContractType.STAGE ||
      contractType === ContractType.ALTERNANCE;
    const level = entryLevel ? LEVELS[0] : LEVELS[(i * 7) % LEVELS.length];
    const place = i % 5 === 0 ? PLACES[(i * 3) % PLACES.length] : company.place;
    const hasSalary =
      contractType === ContractType.CDI || contractType === ContractType.CDD;
    const skillNames = template.skills.map(
      (slug) => skillNameBySlug.get(slug) ?? slug,
    );
    const title = `${template.title} ${level.label}`;

    await prisma.job.create({
      data: {
        companyId: company.id,
        title,
        description:
          `${company.name} recrute pour renforcer son équipe produit : ${title}. ` +
          `Vous travaillerez au quotidien avec ${skillNames.join(', ')}, en lien avec le design et le produit. ` +
          `Nous valorisons la qualité du code, les revues entre pairs et l'autonomie. ` +
          `Offre fictive de démonstration.`,
        category: template.category,
        contractType,
        remotePolicy: REMOTES[(i * 5) % REMOTES.length],
        experienceLevel: level.level,
        city: place.city,
        region: place.region,
        salaryMin: hasSalary ? level.salary[0] : null,
        salaryMax: hasSalary ? level.salary[1] : null,
        ...lifecycleFor(i, now),
        skills: {
          create: template.skills.map((slug) => {
            const skillId = skillIdBySlug.get(slug);
            if (!skillId)
              throw new Error(`Unknown skill in seed template: ${slug}`);
            return { skillId };
          }),
        },
      },
    });
  }
  console.log(
    `Seeded ${TOTAL_JOBS} jobs (live, past-expiry, draft, closed, expired)`,
  );
}

async function main(): Promise<void> {
  await seedAdmin();
  const skillIdBySlug = await seedSkills();
  await seedCompaniesAndJobs(skillIdBySlug);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
