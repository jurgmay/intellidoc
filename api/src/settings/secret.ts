/**
 * Encrypts the one setting that is a password (network access), so it is never in the database in the clear and never sent back to the browser.
 * AES-256-GCM; the key is derived from INTELLIDOC_SECRET_KEY (any passphrase of 16 characters or more) in the API's .env file.
 * Stored as "v1:" + base64(iv, tag, ciphertext). Lose the key and the saved password cannot be read: enter it again.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

export class SecretKeyMissing extends Error {
  constructor() { super('The password cannot be saved because INTELLIDOC_SECRET_KEY is not set in the API\'s .env file (any passphrase of 16 characters or more). Set it, restart the API and save again.'); }
}

export class SecretBox {
  private readonly key: Buffer;
  constructor(passphrase: string) {
    if (passphrase.length < 16) throw new Error('INTELLIDOC_SECRET_KEY must be at least 16 characters');
    this.key = scryptSync(passphrase, 'intellidoc-settings-v1', 32);
  }
  encrypt(plain: string): string {
    const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return `v1:${Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')}`;
  }
  /** Throws if the text was not written with this key. */
  decrypt(stored: string): string {
    if (!stored.startsWith('v1:')) throw new Error('Not an encrypted value');
    const raw = Buffer.from(stored.slice(3), 'base64');
    const d = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  }
}

/** From the environment, or null when INTELLIDOC_SECRET_KEY is not set. */
export function secretBoxFromEnv(env: Record<string, string | undefined> = process.env): SecretBox | null {
  const k = env['INTELLIDOC_SECRET_KEY'];
  return k ? new SecretBox(k) : null;
}
