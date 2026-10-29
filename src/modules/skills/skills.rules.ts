export interface SkillTermsInput {
  slug: string;
  name: string;
  aliases: readonly string[];
}

export interface ExistingSkill extends SkillTermsInput {
  id: string;
}

export interface TermConflict {
  term: string;
  with: string;
}

export function normalizeAliases(aliases: readonly string[]): string[] {
  return [
    ...new Set(
      aliases
        .map((alias) => alias.trim().toLowerCase())
        .filter((alias) => alias.length > 0),
    ),
  ];
}

// every spelling that must identify exactly one skill
export function skillTerms(skill: SkillTermsInput): string[] {
  return [
    ...new Set([
      skill.slug.toLowerCase(),
      skill.name.trim().toLowerCase(),
      ...skill.aliases.map((alias) => alias.trim().toLowerCase()),
    ]),
  ];
}

// the same invariant the seed data test enforces: no term (slug, name or alias) maps to two skills
export function findTermConflict(
  candidate: SkillTermsInput,
  existing: readonly ExistingSkill[],
  selfId?: string,
): TermConflict | null {
  const owners = new Map<string, string>();
  for (const other of existing) {
    if (other.id === selfId) continue;
    for (const term of skillTerms(other)) {
      if (!owners.has(term)) owners.set(term, other.slug);
    }
  }
  for (const term of skillTerms(candidate)) {
    const owner = owners.get(term);
    if (owner !== undefined) return { term, with: owner };
  }
  return null;
}
