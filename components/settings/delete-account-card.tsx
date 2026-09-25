'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { signOutAfterAccountDeletion, reauthenticateWithGoogleAction } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { deleteJSON } from '@/lib/api-client';

type DeleteStatus = 'idle' | 'submitting' | 'error';

// Mirrors the server's window in lib/services/accountDeletion.ts — this
// copy is a UX convenience only; the server independently re-derives and
// re-checks freshness from the session at request time, so a stale client
// clock can only make the button too conservative, never too permissive.
const GOOGLE_REAUTH_WINDOW_MS = 5 * 60 * 1000;

export const DeleteAccountCard = ({
  email,
  hasPassword,
  googleReauthenticatedAt,
}: {
  email: string;
  hasPassword: boolean;
  googleReauthenticatedAt: number | null;
}): React.ReactElement => {
  const [confirmEmailInput, setConfirmEmailInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState<DeleteStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  // Wall-clock reads are impure, so freshness is computed once (lazy
  // initializer, same exemption this codebase already relies on for
  // `useState(() => new Date())` elsewhere) rather than inline on every
  // render. A full page reload — including the one after
  // `reauthenticateWithGoogleAction`'s redirect back to /settings — remounts
  // this component and recomputes it from the new prop. Explicitly flipped
  // false below if the server ever disagrees (a 428 mid-session, the window
  // having lapsed between page load and submit).
  const [googleReauthFresh, setGoogleReauthFresh] = useState(
    () =>
      !hasPassword &&
      googleReauthenticatedAt !== null &&
      Date.now() - googleReauthenticatedAt < GOOGLE_REAUTH_WINDOW_MS,
  );

  const emailMatches = confirmEmailInput.trim().toLowerCase() === email.toLowerCase();
  const canSubmit = emailMatches && (hasPassword ? password.length > 0 : googleReauthFresh);

  const handleSubmit = (): void => {
    if (!canSubmit) return;
    setConfirmOpen(true);
  };

  const handleConfirm = async (): Promise<void> => {
    setStatus('submitting');
    setError(null);

    const res = await deleteJSON('/api/settings/account', {
      confirmEmail: confirmEmailInput,
      currentPassword: hasPassword ? password : undefined,
    });

    setConfirmOpen(false);

    if (!res.ok) {
      if (res.networkError) {
        setStatus('error');
        setError('Could not reach the server. Check your connection and try again.');
        return;
      }
      const body = res.body as { requiresGoogleReauth?: boolean } | null;
      const message = res.error ?? 'Could not delete your account. Try again.';
      if (message === 'Password is incorrect.') {
        setPassword('');
      }
      if (body?.requiresGoogleReauth === true) {
        // The 5-minute window lapsed between page load and submit — put the
        // "Confirm identity with Google" button back in view rather than
        // leaving a doomed retry available.
        setGoogleReauthFresh(false);
      }
      setStatus('error');
      setError(message);
      return;
    }

    // Redirect-throwing server action: stays outside any try/catch, or the
    // redirect gets swallowed and the user is stranded on a page whose
    // account no longer exists (same reasoning as change-password-form.tsx).
    await signOutAfterAccountDeletion();
  };

  return (
    <div className="border-rose/40 bg-paper-raised rounded-2xl border p-5">
      <h2 className="font-display text-rose text-[15px] font-semibold">Delete account</h2>
      <p className="text-ink-muted mt-1 text-[13.5px]">
        This permanently deletes your account, accounts, transactions, budgets, categories, rules,
        and reimbursement history. This cannot be undone.
      </p>

      {/*
        A plain div, not a <form>: the Google branch below renders
        GoogleSignInButton, which is itself a <form> (it posts a server
        action). Nesting a <form> inside a <form> is invalid HTML and Next
        flags it as a hydration error, so submission here is driven by the
        button's onClick rather than a form's onSubmit.
      */}
      <div className="mt-3.5 flex flex-col gap-3.5">
        <div>
          <Label htmlFor="confirmEmail">{`Type ${email} to confirm`}</Label>
          <Input
            id="confirmEmail"
            value={confirmEmailInput}
            onChange={(e) => setConfirmEmailInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
              }
            }}
            aria-describedby="confirmEmail-hint"
            autoComplete="off"
          />
          <p id="confirmEmail-hint" className="sr-only" aria-live="polite">
            {emailMatches
              ? 'Email confirmed.'
              : `Type ${email} exactly to enable account deletion.`}
          </p>
        </div>

        {hasPassword ? (
          <div>
            <Label htmlFor="deleteAccountPassword">Password</Label>
            <Input
              id="deleteAccountPassword"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              autoComplete="current-password"
            />
          </div>
        ) : (
          <div>
            {googleReauthFresh ? (
              <p className="text-sky text-[13.5px]">
                Confirmed with Google — you have 5 minutes to finish deleting your account.
              </p>
            ) : (
              <GoogleSignInButton
                label="Confirm identity with Google"
                action={reauthenticateWithGoogleAction}
              />
            )}
          </div>
        )}

        <Button
          type="button"
          onClick={handleSubmit}
          variant="danger"
          icon={Trash2}
          disabled={!canSubmit}
          className="self-start"
        >
          Delete account
        </Button>
      </div>

      {error && (
        <p className="bg-rose-soft text-rose mt-3 rounded-lg px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Delete your account?"
        description="This permanently deletes your account, accounts, transactions, budgets, categories, rules, and reimbursement history. This cannot be undone."
        confirmLabel="Delete account"
        danger
        pending={status === 'submitting'}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
};
