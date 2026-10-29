import { describe, expect, it } from 'vitest';
import { createSavedSearchSchema, updateSavedSearchSchema } from './saved.dto';

describe('createSavedSearchSchema', () => {
  it('normalizes filters and applies defaults', () => {
    const parsed = createSavedSearchSchema.parse({
      name: '  Node remote  ',
      filters: {
        q: 'node.js',
        category: 'backend,fullstack',
        skills: 'NodeJS',
      },
    });
    expect(parsed.name).toBe('Node remote');
    expect(parsed.filters).toMatchObject({
      q: 'node.js',
      category: ['BACKEND', 'FULLSTACK'],
      skills: ['nodejs'],
    });
    expect(parsed.frequency).toBe('DAILY');
    expect(parsed.alertsEnabled).toBe(true);
  });

  it('rejects a search without any criterion', () => {
    expect(
      createSavedSearchSchema.safeParse({ name: 'Empty', filters: {} }).success,
    ).toBe(false);
    expect(
      createSavedSearchSchema.safeParse({ name: 'Blank', filters: { q: '  ' } })
        .success,
    ).toBe(false);
  });

  it('rejects an invalid enum value, frequency or name', () => {
    expect(
      createSavedSearchSchema.safeParse({
        name: 'x',
        filters: { category: 'cooking' },
      }).success,
    ).toBe(false);
    expect(
      createSavedSearchSchema.safeParse({
        name: 'x',
        filters: { q: 'a' },
        frequency: 'HOURLY',
      }).success,
    ).toBe(false);
    expect(
      createSavedSearchSchema.safeParse({ name: '', filters: { q: 'a' } })
        .success,
    ).toBe(false);
  });

  it('rejects salaryMin above salaryMax', () => {
    expect(
      createSavedSearchSchema.safeParse({
        name: 'x',
        filters: { salaryMin: 90000, salaryMax: 1000 },
      }).success,
    ).toBe(false);
  });

  it('drops unknown filter keys', () => {
    const parsed = createSavedSearchSchema.parse({
      name: 'x',
      filters: { q: 'react', evil: 'drop table' },
    });
    expect(parsed.filters).not.toHaveProperty('evil');
  });
});

describe('updateSavedSearchSchema', () => {
  it('accepts a partial update', () => {
    expect(updateSavedSearchSchema.parse({ alertsEnabled: false })).toEqual({
      alertsEnabled: false,
    });
  });

  it('still requires a criterion when filters are replaced', () => {
    expect(updateSavedSearchSchema.safeParse({ filters: {} }).success).toBe(
      false,
    );
  });
});
