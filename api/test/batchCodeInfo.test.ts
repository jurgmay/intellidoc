import { describe, expect, it } from 'vitest';
import { nextBatchCodeInfo } from '../src/settings/store.js';

describe('nextBatchCodeInfo', () => {
  it('starts from the sequence when no batch exists', () => {
    expect(nextBatchCodeInfo(null, null)).toEqual({ highestUsed: null, next: 1 });
    expect(nextBatchCodeInfo(null, 5000)).toEqual({ highestUsed: null, next: 5000 });
  });
  it('is one more than the highest batch once the sequence has issued it', () => {
    expect(nextBatchCodeInfo(7000, 7000)).toEqual({ highestUsed: 7000, next: 7001 });
  });
  it('shows a number the user has set above the highest batch', () => {
    expect(nextBatchCodeInfo(7000, 8000)).toEqual({ highestUsed: 7000, next: 8000 });
  });
});
