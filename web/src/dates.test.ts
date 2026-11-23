import { describe, expect, it } from 'vitest';
import { ukDate, ukDateTime } from './dates';

describe('ukDate', () => {
  it('writes day, month, year', () => {
    expect(ukDate('2026-11-18')).toBe('18/11/2026');
    expect(ukDate('2026-01-05T09:30:00')).toBe('05/01/2026');
    expect(ukDate('2026-11-18T23:59:59.000Z')).toBe('18/11/2026'); // not moved to another day
  });
  it('leaves anything else alone', () => { expect(ukDate('')).toBe(''); expect(ukDate('soon')).toBe('soon'); });
  it('adds the time', () => {
    expect(ukDateTime('2026-11-18T09:31:00')).toBe('18/11/2026 09:31');
    expect(ukDateTime('2026-11-18')).toBe('18/11/2026');
  });
});
