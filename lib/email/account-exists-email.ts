import { renderEmailHtml, type TransactionalEmail } from '@/lib/email/layout';

/**
 * Sent instead of a verification link when someone signs up with an address
 * that already has an account. The signup form shows the same response
 * either way, so this email is the only place the owner learns about it.
 *
 * Deliberately doesn't say whether the account uses a password or Google, so
 * a forwarded or intercepted copy gives away as little as possible.
 */
export const buildAccountExistsEmail = ({
  appUrl,
  loginUrl,
}: {
  appUrl: string;
  loginUrl: string;
}): TransactionalEmail => {
  const subject = 'You already have a Ledger account';

  const html = renderEmailHtml({
    appUrl,
    subject,
    preheader: 'Someone tried to sign up with this address. Sign in instead.',
    heading: 'You already have an account',
    intro:
      'Someone just tried to create a Ledger account with this email address. It already has one, so nothing was changed. Sign in with your password, or with Google if that is how you signed up.',
    buttonLabel: 'Sign in to Ledger',
    buttonUrl: loginUrl,
    footer: "If this wasn't you, you can ignore this email. Your account is unchanged.",
  });

  const text = [
    'You already have an account',
    '',
    'Someone just tried to create a Ledger account with this email address. It already has one, so nothing was changed.',
    'Sign in with your password, or with Google if that is how you signed up.',
    '',
    `Sign in: ${loginUrl}`,
    '',
    "If this wasn't you, you can ignore this email. Your account is unchanged.",
  ].join('\n');

  return { subject, html, text };
};
