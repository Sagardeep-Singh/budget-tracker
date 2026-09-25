import { describe, expect, it } from 'vitest';

import { clientIpFromHeaders } from '@/lib/http/clientIp';

describe('clientIpFromHeaders', () => {
  it('takes the first hop off a comma-separated x-forwarded-for chain', () => {
    const headers = new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
    expect(clientIpFromHeaders(headers)).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const headers = new Headers({ 'x-real-ip': '9.9.9.9' });
    expect(clientIpFromHeaders(headers)).toBe('9.9.9.9');
  });

  it('falls back to "unknown" when neither header is present', () => {
    const headers = new Headers();
    expect(clientIpFromHeaders(headers)).toBe('unknown');
  });
});
