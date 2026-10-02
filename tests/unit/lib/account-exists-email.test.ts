import { describe, expect, it } from 'vitest';
import { buildAccountExistsEmail } from '@/lib/email/account-exists-email';

const build = (loginUrl = 'https://ledger.test/login') =>
  buildAccountExistsEmail({ appUrl: 'https://ledger.test/', loginUrl });

describe('buildAccountExistsEmail', () => {
  it('links the button to the login URL', () => {
    const { html } = build();
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(['https://ledger.test/login']);
    expect(html).toContain('Sign in to Ledger');
  });

  it('loads the PNG logo from the app origin, without a double slash', () => {
    expect(build().html).toContain('src="https://ledger.test/icons/icon-192.png"');
  });

  it('escapes the URL so it cannot break out of the attribute', () => {
    const { html } = build('https://ledger.test/login?a="><script>x</script>');
    expect(html).not.toContain('<script>');
  });

  it('carries the raw link in the plain-text part and never says how the account signs in', () => {
    const { subject, text } = build();
    expect(subject).toBe('You already have a Ledger account');
    expect(text).toContain('Sign in: https://ledger.test/login');
    expect(text).toContain('or with Google if that is how you signed up');
  });
});
