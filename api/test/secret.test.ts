import { describe, expect, it } from 'vitest';
import { SecretBox, secretBoxFromEnv } from '../src/settings/secret.js';

describe('SecretBox', () => {
  const box = new SecretBox('a passphrase long enough');
  it('round-trips, and never writes the text or the same ciphertext twice', () => {
    const a = box.encrypt('p@ss w0rd \u00e9'), b = box.encrypt('p@ss w0rd \u00e9');
    expect(a).toMatch(/^v1:/); expect(a).not.toContain('p@ss'); expect(a).not.toBe(b);
    expect(box.decrypt(a)).toBe('p@ss w0rd \u00e9');
  });
  it('cannot be read with another key or after tampering', () => {
    const a = box.encrypt('hello');
    expect(() => new SecretBox('another passphrase!!').decrypt(a)).toThrow();
    const raw = Buffer.from(a.slice(3), 'base64'); raw[raw.length - 1]! ^= 1;
    expect(() => box.decrypt(`v1:${raw.toString('base64')}`)).toThrow();
    expect(() => box.decrypt('plain')).toThrow(/Not an encrypted value/);
  });
  it('wants a passphrase of 16 or more characters, from INTELLIDOC_SECRET_KEY', () => {
    expect(() => new SecretBox('short')).toThrow(/16/);
    expect(secretBoxFromEnv({})).toBeNull();
    expect(secretBoxFromEnv({ INTELLIDOC_SECRET_KEY: 'a passphrase long enough' })!.decrypt(box.encrypt('x'))).toBe('x');
  });
});
