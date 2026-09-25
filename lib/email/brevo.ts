/**
 * Hand-rolled `fetch` transport for Brevo's transactional email API — same
 * no-SDK shape as lib/ai/anthropic.ts. One POST per send.
 *
 * `BASE_URL` is a module constant read once from server config, mirroring the
 * AI providers' `AI_*_BASE_URL` override so the e2e suite can point it at a
 * local fixture server without any user-reachable override.
 */
const BASE_URL = process.env.BREVO_BASE_URL ?? 'https://api.brevo.com';

const apiKey = (): string | undefined => process.env.BREVO_API_KEY;
const senderEmail = (): string | undefined => process.env.BREVO_SENDER_EMAIL;
const senderName = (): string => process.env.BREVO_SENDER_NAME ?? 'Ledger';

/** The Brevo integration has no API key/sender configured — the feature is off, not broken. */
export class EmailUnavailableError extends Error {
  constructor() {
    super('Email sending is not configured on this deployment.');
    this.name = 'EmailUnavailableError';
  }
}

/** A transport-level failure or a non-2xx from Brevo. Never carries the response body — it may echo the recipient address. */
export class EmailSendError extends Error {
  constructor(reason: string) {
    super(`Failed to send email: ${reason}`);
    this.name = 'EmailSendError';
  }
}

export const isEmailConfigured = (): boolean => Boolean(apiKey() && senderEmail());

export const sendEmail = async (params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> => {
  const key = apiKey();
  const from = senderEmail();
  if (!key || !from) {
    throw new EmailUnavailableError();
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/v3/smtp/email`, {
      method: 'POST',
      headers: {
        'api-key': key,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: senderName(), email: from },
        to: [{ email: params.to }],
        subject: params.subject,
        htmlContent: params.html,
      }),
    });
  } catch {
    throw new EmailSendError('network');
  }

  if (!response.ok) {
    throw new EmailSendError(`brevo responded ${response.status}`);
  }
};
