import { describe, expect, it } from 'vitest';
import {
  findTermConflict,
  normalizeAliases,
  skillTerms,
  type ExistingSkill,
} from './skills.rules';

const existing: ExistingSkill[] = [
  { id: '1', slug: 'nodejs', name: 'Node.js', aliases: ['node', 'node.js'] },
  { id: '2', slug: 'react', name: 'React', aliases: ['reactjs'] },
];

describe('normalizeAliases', () => {
  it('trims, lowercases, drops blanks and duplicates', () => {
    expect(normalizeAliases([' Foo ', 'foo', '', '  ', 'BAR'])).toEqual([
      'foo',
      'bar',
    ]);
  });
});

describe('skillTerms', () => {
  it('collects slug, name and aliases once each, lowercase', () => {
    expect(
      skillTerms({
        slug: 'nodejs',
        name: 'Node.js',
        aliases: ['Node', 'node.js'],
      }).sort(),
    ).toEqual(['node', 'node.js', 'nodejs']);
  });
});

describe('findTermConflict', () => {
  it('returns null when every term is free', () => {
    expect(
      findTermConflict(
        { slug: 'vue', name: 'Vue', aliases: ['vuejs'] },
        existing,
      ),
    ).toBeNull();
  });

  it('detects an alias that is another skill alias, slug or name', () => {
    expect(
      findTermConflict({ slug: 'x', name: 'X', aliases: ['node'] }, existing),
    ).toEqual({
      term: 'node',
      with: 'nodejs',
    });
    expect(
      findTermConflict({ slug: 'x', name: 'X', aliases: ['react'] }, existing),
    ).toEqual({
      term: 'react',
      with: 'react',
    });
    expect(
      findTermConflict({ slug: 'x', name: 'X', aliases: ['node.js'] }, existing)
        ?.with,
    ).toBe('nodejs');
  });

  it('detects a slug or name clash, ignoring case', () => {
    expect(
      findTermConflict({ slug: 'react', name: 'Other', aliases: [] }, existing)
        ?.with,
    ).toBe('react');
    expect(
      findTermConflict(
        { slug: 'other', name: 'NODE.JS', aliases: [] },
        existing,
      )?.with,
    ).toBe('nodejs');
  });

  it('ignores the skill being updated', () => {
    expect(
      findTermConflict(
        { slug: 'react', name: 'React', aliases: ['reactjs', 'react.js'] },
        existing,
        '2',
      ),
    ).toBeNull();
  });
});
