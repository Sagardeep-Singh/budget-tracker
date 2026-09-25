'use client';

import { useState } from 'react';
import { postJSON } from '@/lib/api-client';

export const UnverifiedEmailBanner = (): React.ReactElement => {
  const [status, setStatus] = useState<'idle' | 'pending' | 'sent'>('idle');
  const [notice, setNotice] = useState<string | null>(null);

  const resend = async (): Promise<void> => {
    setStatus('pending');
    setNotice(null);
    const result = await postJSON('/api/auth/verify/resend', {});
    if (result.ok) {
      setStatus('sent');
      return;
    }
    setStatus('idle');
    setNotice(
      result.status === 429
        ? 'Please wait a bit before requesting another email.'
        : "Couldn't send the email — try again shortly.",
    );
  };

  return (
    <div
      className="bg-sky-soft text-sky mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-2.5 text-[13px]"
      role="status"
    >
      <span>Verify your email to secure your account.</span>
      {status === 'sent' ? (
        <span className="font-medium">Email sent — check your inbox.</span>
      ) : (
        <button
          type="button"
          onClick={() => void resend()}
          disabled={status === 'pending'}
          className="text-iris font-medium underline underline-offset-2 disabled:opacity-60"
        >
          {status === 'pending' ? 'Sending…' : 'Resend email'}
        </button>
      )}
      {notice && <span className="text-ink-muted w-full text-xs">{notice}</span>}
    </div>
  );
};
