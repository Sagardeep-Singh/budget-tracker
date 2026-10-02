import { describe, expect, it } from 'vitest';
import { buildVerificationEmail } from '@/lib/email/verification-email';

const build = (verifyUrl = 'https://ledger.test/api/auth/verify?token=abc123') =>
  buildVerificationEmail({ appUrl: 'https://ledger.test/', verifyUrl, hoursValid: 24 });

describe('buildVerificationEmail', () => {
  it('links the button and the fallback text to the verify URL', () => {
    const { html } = build();
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([
      'https://ledger.test/api/auth/verify?token=abc123',
      'https://ledger.test/api/auth/verify?token=abc123',
    ]);
    expect(html).toContain('Verify email address');
  });

  it('loads the PNG logo from the app origin, without a double slash', () => {
    expect(build().html).toContain('src="https://ledger.test/icons/icon-192.png"');
  });

  it('states the expiry it was given', () => {
    const { html, text } = build();
    expect(html).toContain('expires in 24 hours');
    expect(text).toContain('expires in 24 hours');
  });

  it('escapes the URL so it cannot break out of the attribute', () => {
    const { html } = build('https://ledger.test/verify?token=a"><script>x</script>&b=1');
    expect(html).not.toContain('<script>');
    expect(html).toContain('token=a&quot;&gt;&lt;script&gt;x&lt;/script&gt;&amp;b=1');
  });

  it('carries the raw link in the plain-text part', () => {
    const { subject, text } = build();
    expect(subject).toBe('Verify your Track a Loonie email address');
    expect(text).toContain('Verify your email: https://ledger.test/api/auth/verify?token=abc123');
  });
});
