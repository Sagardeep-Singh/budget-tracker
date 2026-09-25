import { NextResponse } from 'next/server';
import { consumeVerificationToken } from '@/lib/services/emailVerification';

/**
 * Public by design — clicked from an email client, no session cookie
 * required. Redirects rather than JSON: this is a link a person clicks, not
 * an API call.
 */
export const GET = async (request: Request): Promise<NextResponse> => {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) {
    return NextResponse.redirect(new URL('/login?verify=invalid', request.url));
  }

  const result = await consumeVerificationToken(token);
  return NextResponse.redirect(new URL(`/login?verify=${result}`, request.url));
};
