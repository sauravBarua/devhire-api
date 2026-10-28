import { describe, expect, it } from 'vitest';
import { SKILLS } from './skills.data';

describe('SKILLS seed data', () => {
  it('has well-formed slugs', () => {
    for (const skill of SKILLS) {
      expect(skill.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('keeps aliases lowercase and trimmed', () => {
    for (const skill of SKILLS) {
      for (const alias of skill.aliases) {
        expect(alias).toBe(alias.trim().toLowerCase());
      }
    }
  });

  it('never maps the same term (slug, name or alias) to two skills', () => {
    const owners = new Map<string, string>();
    for (const skill of SKILLS) {
      const terms = new Set([
        skill.slug,
        skill.name.toLowerCase(),
        ...skill.aliases,
      ]);
      for (const term of terms) {
        const owner = owners.get(term);
        expect(
          owner,
          `"${term}" is used by ${owner} and ${skill.slug}`,
        ).toBeUndefined();
        owners.set(term, skill.slug);
      }
    }
  });
});
