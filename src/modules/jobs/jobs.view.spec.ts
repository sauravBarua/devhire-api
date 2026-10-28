import { describe, expect, it } from 'vitest';
import { daysSince } from './jobs.view';

const now = new Date('2026-01-15T10:00:00.000Z');
const hoursAgo = (hours: number): Date =>
  new Date(now.getTime() - hours * 60 * 60 * 1000);

describe('daysSince', () => {
  it('returns null when the job was never published', () => {
    expect(daysSince(null, now)).toBeNull();
  });

  it('returns 0 for the same instant and for less than a day', () => {
    expect(daysSince(now, now)).toBe(0);
    expect(daysSince(hoursAgo(23), now)).toBe(0);
  });

  it('counts whole days', () => {
    expect(daysSince(hoursAgo(24), now)).toBe(1);
    expect(daysSince(hoursAgo(49), now)).toBe(2);
  });

  it('never returns a negative value', () => {
    expect(daysSince(hoursAgo(-5), now)).toBe(0);
  });
});
