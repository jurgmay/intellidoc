import { describe, expect, it } from 'vitest';
import { longTimeout } from '../src/mssql/devDb.js';

describe('longTimeout', () => {
  it('adds a 10 minute request timeout, tidily', () => {
    expect(longTimeout('Server=a;Database=b;')).toBe('Server=a;Database=b;Request Timeout=600000');
    expect(longTimeout('Server=a;Database=b')).toBe('Server=a;Database=b;Request Timeout=600000');
  });
  it('leaves a timeout the user set alone', () => {
    expect(longTimeout('Server=a;Request Timeout=5000')).toBe('Server=a;Request Timeout=5000');
    expect(longTimeout('Server=a;requestTimeout=5000')).toBe('Server=a;requestTimeout=5000');
  });
});
