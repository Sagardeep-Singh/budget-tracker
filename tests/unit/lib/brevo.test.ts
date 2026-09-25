import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  vi.stubEnv('BREVO_API_KEY', 'key-123');
  vi.stubEnv('BREVO_SENDER_EMAIL', 'noreply@example.com');
  vi.stubEnv('BREVO_SENDER_NAME', 'Ledger');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('isEmailConfigured', () => {
  it('is true when both the key and sender are set', async () => {
    const { isEmailConfigured } = await import('@/lib/email/brevo');
    expect(isEmailConfigured()).toBe(true);
  });

  it('is false when the key is unset', async () => {
    vi.stubEnv('BREVO_API_KEY', '');
    const { isEmailConfigured } = await import('@/lib/email/brevo');
    expect(isEmailConfigured()).toBe(false);
  });
});

describe('sendEmail', () => {
  it('throws EmailUnavailableError when unconfigured, without calling fetch', async () => {
    vi.stubEnv('BREVO_API_KEY', '');
    const { sendEmail, EmailUnavailableError } = await import('@/lib/email/brevo');

    await expect(
      sendEmail({ to: 'a@b.com', subject: 'Hi', html: '<p>hi</p>' }),
    ).rejects.toBeInstanceOf(EmailUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the Brevo transactional endpoint with the configured sender', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201 });
    const { sendEmail } = await import('@/lib/email/brevo');

    await sendEmail({ to: 'a@b.com', subject: 'Verify', html: '<p>link</p>' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/smtp/email',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'api-key': 'key-123' }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({
      sender: { name: 'Ledger', email: 'noreply@example.com' },
      to: [{ email: 'a@b.com' }],
      subject: 'Verify',
      htmlContent: '<p>link</p>',
    });
  });

  it('throws EmailSendError on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    const { sendEmail, EmailSendError } = await import('@/lib/email/brevo');

    await expect(
      sendEmail({ to: 'a@b.com', subject: 'Hi', html: '<p>hi</p>' }),
    ).rejects.toBeInstanceOf(EmailSendError);
  });

  it('throws EmailSendError on a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { sendEmail, EmailSendError } = await import('@/lib/email/brevo');

    await expect(
      sendEmail({ to: 'a@b.com', subject: 'Hi', html: '<p>hi</p>' }),
    ).rejects.toBeInstanceOf(EmailSendError);
  });
});
