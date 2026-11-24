import { describe, expect, it } from 'vitest';
import { comparePacks } from '../src/packOrder.js';

const k = (ownerAccount: string, ownerUser: string, release: string, startPage: number) => ({ ownerAccount, ownerUser, releaseDate: new Date(release), startPage });
describe('comparePacks', () => {
  it('sorts by owner account, owner user, release date, then source page, ignoring case', () => {
    const rows = [k('b', 'x', '2026-01-01', 1), k('A', 'y', '2026-01-01', 2), k('a', 'x', '2026-02-01', 3), k('a', 'X', '2026-01-01', 9), k('a', 'x', '2026-01-01', 4)];
    expect([...rows].sort(comparePacks).map((r) => r.startPage)).toEqual([4, 9, 3, 2, 1]);
  });
});
