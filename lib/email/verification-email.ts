import {
  BODY_FONT,
  COLORS,
  MONO_FONT,
  escapeHtml,
  renderEmailHtml,
  type TransactionalEmail,
} from '@/lib/email/layout';

export type VerificationEmail = TransactionalEmail;

/**
 * `appUrl` is the app's origin (for the logo); `verifyUrl` is the full
 * one-time link. `hoursValid` is shown in the copy so it can't drift from the
 * token TTL the caller actually uses.
 */
export const buildVerificationEmail = ({
  appUrl,
  verifyUrl,
  hoursValid,
}: {
  appUrl: string;
  verifyUrl: string;
  hoursValid: number;
}): VerificationEmail => {
  const subject = 'Verify your Track a Loonie email address';
  const href = escapeHtml(verifyUrl);

  const html = renderEmailHtml({
    appUrl,
    subject,
    preheader: `One click confirms this address belongs to you. The link expires in ${hoursValid} hours.`,
    heading: 'Confirm your email',
    intro: 'Thanks for signing up. One click confirms this address belongs to you.',
    buttonLabel: 'Verify email address',
    buttonUrl: verifyUrl,
    detailsHtml: `
            <p class="l-muted" style="margin:28px 0 8px;font-family:${BODY_FONT};font-size:13px;line-height:1.5;color:${COLORS.inkMuted};">The link expires in ${hoursValid} hours. If the button doesn't work, paste this into your browser:</p>
            <p class="l-code" style="margin:0;padding:10px 12px;border-radius:10px;background-color:${COLORS.paperSunk};font-family:${MONO_FONT};font-size:12px;line-height:1.5;word-break:break-all;color:${COLORS.inkMuted};"><a class="l-link" href="${href}" target="_blank" style="color:${COLORS.accent};text-decoration:none;">${href}</a></p>`,
    footer:
      "If you didn't create a Track a Loonie account, you can ignore this email. Nothing happens until the link is clicked.",
  });

  const text = [
    'Confirm your email',
    '',
    'Thanks for signing up for Track a Loonie. One click confirms this address belongs to you.',
    '',
    `Verify your email: ${verifyUrl}`,
    '',
    `The link expires in ${hoursValid} hours.`,
    '',
    "If you didn't create a Track a Loonie account, you can ignore this email.",
  ].join('\n');

  return { subject, html, text };
};
