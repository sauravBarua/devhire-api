import { describe, expect, it } from 'vitest';
import { slugify } from './slugify';

describe('slugify', () => {
  it('removes accents and lowercases', () => {
    expect(slugify('Acme Études')).toBe('acme-etudes');
  });

  it('collapses punctuation and trims dashes', () => {
    expect(slugify('  Foo & Bar!! ')).toBe('foo-bar');
  });

  it('falls back when nothing usable remains', () => {
    expect(slugify('!!!')).toBe('company');
  });

  it('truncates long names without a trailing dash', () => {
    const slug = slugify(`${'a'.repeat(59)} bbbb`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });
});
