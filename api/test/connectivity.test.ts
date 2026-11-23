import { describe, expect, it } from 'vitest';
import { fromHeader, sendTestEmail, smtpFromValues, testEmailRecipients } from '../src/settings/connectivity.js';

describe('smtpFromValues', () => {
  const base = { smtpServer: 'smtp.office365.com', smtpPort: 587, smtpFromName: 'Intelli "Doc"', smtpFromAddress: 'idoc@latcham.co.uk', smtpReplyTo: '', smtpUsername: '' };
  it('builds the sender, drops quotes from the name, and uses TLS from the start only on 465', () => {
    expect(smtpFromValues(base, null)).toEqual({ smtp: { host: 'smtp.office365.com', port: 587, secure: false, user: undefined, pass: undefined, from: '"Intelli Doc" <idoc@latcham.co.uk>', replyTo: undefined } });
    expect(smtpFromValues({ ...base, smtpPort: 465 }, null)).toMatchObject({ smtp: { secure: true } });
    expect(fromHeader('', 'a@b.co')).toBe('a@b.co');
    expect(fromHeader('A\r\nBcc: x', 'a@b.co')).toBe('"ABcc: x" <a@b.co>');
  });
  it('wants a password with a username, but not without one', () => {
    expect(smtpFromValues({ ...base, smtpUsername: 'svc' }, null)).toHaveProperty('error');
    expect(smtpFromValues({ ...base, smtpUsername: 'svc' }, 'pw')).toMatchObject({ smtp: { user: 'svc', pass: 'pw' } });
    expect(smtpFromValues({ ...base, smtpUsername: '' }, 'stale')).toMatchObject({ smtp: { user: undefined, pass: undefined } });
  });
  it('takes the test e-mail recipients from the alert recipients', () => { expect(testEmailRecipients({ alertRecipients: 'a@b.co; c@d.co' })).toEqual(['a@b.co', 'c@d.co']); expect(testEmailRecipients({ alertRecipients: '' })).toEqual([]); });
});

describe('sendTestEmail', () => {
  const smtp = { host: 'smtp.example.com', port: 587, secure: false, from: 'a@b.co' };
  it('sends one message and says who got it', async () => {
    const seen: { to: string[]; subject: string; text: string }[] = [];
    const r = await sendTestEmail(smtp, ['x@y.co'], { send: async (to, subject, text) => { seen.push({ to, subject, text }); } });
    expect(r).toEqual({ ok: true, message: 'Test e-mail sent to x@y.co. Check the inbox.' });
    expect(seen[0]).toMatchObject({ to: ['x@y.co'], subject: 'IntelliDoc test e-mail' }); expect(seen[0]!.text).toContain('smtp.example.com:587');
  });
  it('returns a failure as the result, never throws', async () => {
    const r = await sendTestEmail(smtp, ['x@y.co'], { send: async () => { throw Object.assign(new Error('Invalid login: 535 5.7.3 Authentication unsuccessful'), { code: 'EAUTH' }); } });
    expect(r.ok).toBe(false); expect(r.message).toBe('The test e-mail could not be sent (EAUTH): Invalid login: 535 5.7.3 Authentication unsuccessful');
  });
});
