export interface SkillSeed {
  slug: string;
  name: string;
  aliases: string[];
}

// aliases are lowercase; later the search phase maps free text to a skill through them
export const SKILLS: SkillSeed[] = [
  { slug: 'javascript', name: 'JavaScript', aliases: ['js', 'ecmascript'] },
  { slug: 'typescript', name: 'TypeScript', aliases: ['ts'] },
  { slug: 'html', name: 'HTML', aliases: ['html5'] },
  { slug: 'css', name: 'CSS', aliases: ['css3'] },
  { slug: 'react', name: 'React', aliases: ['reactjs', 'react.js'] },
  { slug: 'nextjs', name: 'Next.js', aliases: ['next', 'next.js'] },
  { slug: 'vuejs', name: 'Vue.js', aliases: ['vue', 'vue.js'] },
  { slug: 'angular', name: 'Angular', aliases: [] },
  { slug: 'svelte', name: 'Svelte', aliases: ['sveltekit'] },
  { slug: 'tailwindcss', name: 'Tailwind CSS', aliases: ['tailwind'] },
  {
    slug: 'react-native',
    name: 'React Native',
    aliases: ['reactnative', 'react native'],
  },
  { slug: 'nodejs', name: 'Node.js', aliases: ['node', 'node.js'] },
  { slug: 'nestjs', name: 'NestJS', aliases: ['nest', 'nest.js'] },
  { slug: 'express', name: 'Express', aliases: ['expressjs', 'express.js'] },
  { slug: 'php', name: 'PHP', aliases: [] },
  { slug: 'laravel', name: 'Laravel', aliases: [] },
  { slug: 'symfony', name: 'Symfony', aliases: [] },
  { slug: 'python', name: 'Python', aliases: [] },
  { slug: 'django', name: 'Django', aliases: [] },
  { slug: 'fastapi', name: 'FastAPI', aliases: [] },
  { slug: 'java', name: 'Java', aliases: [] },
  { slug: 'spring', name: 'Spring', aliases: ['spring boot', 'springboot'] },
  { slug: 'dotnet', name: '.NET', aliases: ['dotnet', '.net core', 'asp.net'] },
  { slug: 'csharp', name: 'C#', aliases: ['c#', 'c sharp'] },
  { slug: 'go', name: 'Go', aliases: ['golang'] },
  {
    slug: 'ruby-on-rails',
    name: 'Ruby on Rails',
    aliases: ['rails', 'ror', 'ruby'],
  },
  { slug: 'graphql', name: 'GraphQL', aliases: [] },
  { slug: 'postgresql', name: 'PostgreSQL', aliases: ['postgres', 'psql'] },
  { slug: 'mysql', name: 'MySQL', aliases: [] },
  { slug: 'mongodb', name: 'MongoDB', aliases: ['mongo'] },
  { slug: 'redis', name: 'Redis', aliases: [] },
  { slug: 'docker', name: 'Docker', aliases: [] },
  { slug: 'kubernetes', name: 'Kubernetes', aliases: ['k8s'] },
  { slug: 'aws', name: 'AWS', aliases: ['amazon web services'] },
  { slug: 'git', name: 'Git', aliases: [] },
  { slug: 'ci-cd', name: 'CI/CD', aliases: ['cicd', 'ci cd'] },
  { slug: 'jest', name: 'Jest', aliases: [] },
  { slug: 'cypress', name: 'Cypress', aliases: [] },
  { slug: 'playwright', name: 'Playwright', aliases: [] },
];
