// Structurally modeled on components/settings/reminders-section.tsx: an
// `available` early-return card, then a live card with local optimistic
// state seeded from server props.
//
// Disclosure/save ordering (resolved, overrides the ui-designer's original
// accept-then-save sequence): UserAiSettings.provider/encryptedApiKey are
// non-nullable, so a row can't exist from "accept disclosure" alone before a
// key is saved. The modal's "Looks good, continue" button therefore triggers
// the real key save first; only once that succeeds does it stamp disclosure
// acceptance on the now-existing row. If the save fails (e.g. key rejected),
// the accept call never fires and the user sees the disclosure again next
// attempt — harmless, since nothing was sent to a provider either way.
'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import { pillGroup, pillOption } from '@/components/settings/pills';
import { AiDisclosureModal } from '@/components/settings/ai-disclosure-modal';
import type { FrontendAiSettings } from '@/lib/services/aiSettings';
import { AI_PROVIDERS } from '@/lib/validators/ai-settings';

type Provider = (typeof AI_PROVIDERS)[number]; // 'ANTHROPIC' | 'OPENAI'

const PROVIDER_LABELS: Record<Provider, string> = {
  ANTHROPIC: 'Anthropic',
  OPENAI: 'OpenAI',
};

export const AiCategorizationSection = ({
  settings: initialSettings,
}: {
  settings: FrontendAiSettings;
}): React.ReactElement => {
  const [settings, setSettings] = useState(initialSettings);

  // Draft state for the (write-only) key form. `apiKey` is never populated
  // from `settings.maskedKey` — the masked value is display-only and the
  // input starts blank even when a key is already configured, exactly like
  // a password-change form.
  const [provider, setProvider] = useState<Provider>(settings.provider ?? 'ANTHROPIC');
  const [apiKey, setApiKey] = useState('');
  const [sendNote, setSendNote] = useState(settings.sendNote);
  const [sendAmount, setSendAmount] = useState(settings.sendAmount);

  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null); // "saved, not yet verified"

  // Disclosure modal. `dialogKey` forces a fresh preview fetch on every open
  // per this codebase's remount-on-open convention (see match-transfers-dialog).
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);

  // Entry point for the Save button: if the disclosure has never been
  // accepted, show it first; the modal's own Accept handler runs the real
  // save. If already accepted, save runs immediately.
  const handleSaveClick = (): void => {
    if (!settings.disclosureAccepted) {
      setDialogKey((k) => k + 1);
      setDisclosureOpen(true);
      return;
    }
    void doSave();
  };

  // PUT /api/settings/ai. Returns whether the save succeeded, so the
  // disclosure-modal flow knows whether it's safe to stamp acceptance.
  const doSave = async (): Promise<boolean> => {
    setPending(true);
    setNotice(null);
    setWarning(null);
    try {
      const response = await fetch('/api/settings/ai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: apiKey.trim(), sendNote, sendAmount }),
      });
      const body = (await response.json()) as
        (FrontendAiSettings & { warning: string | null }) | { error: string };

      if (!response.ok) {
        // The 400 case is a rejected key. Nothing was persisted, so the form
        // keeps the typed key for a quick correction.
        setNotice('error' in body ? body.error : 'Could not save your API key. Try again.');
        return false;
      }

      const { warning: saveWarning, ...saved } = body as FrontendAiSettings & {
        warning: string | null;
      };
      setSettings(saved);
      setSendNote(saved.sendNote);
      setSendAmount(saved.sendAmount);
      // Write-only form: the field never re-displays what was stored.
      setApiKey('');
      setWarning(saveWarning);
      if (!saveWarning) {
        setNotice(null);
      }
      return true;
    } catch {
      setNotice('Could not save your API key. Try again.');
      return false;
    } finally {
      setPending(false);
    }
  };

  // Modal's Accept handler: save the key first (see file header note), then
  // stamp disclosure acceptance only if that succeeded.
  const handleDisclosureAccept = async (): Promise<void> => {
    const saved = await doSave();
    if (!saved) return; // modal stays open; doSave already surfaced the error
    setPending(true);
    try {
      const response = await fetch('/api/settings/ai/disclosure', { method: 'POST' });
      if (!response.ok) {
        setNotice('Key saved, but could not record your review. Try Save again.');
        return;
      }
      setSettings((await response.json()) as FrontendAiSettings);
      setDisclosureOpen(false);
    } catch {
      setNotice('Key saved, but could not record your review. Try Save again.');
    } finally {
      setPending(false);
    }
  };

  const handleRemove = async (): Promise<void> => {
    setPending(true);
    setNotice(null);
    setWarning(null);
    try {
      const response = await fetch('/api/settings/ai', { method: 'DELETE' });
      if (!response.ok) {
        setNotice('Could not remove your API key. Try again.');
        return;
      }
      // The row is gone, so the disclosure stamp went with it — the next save
      // shows the disclosure again, which is correct rather than a regression.
      setSettings({
        configured: false,
        provider: null,
        maskedKey: null,
        verified: false,
        sendNote: false,
        sendAmount: false,
        disclosureAccepted: false,
        available: settings.available,
      });
      setSendNote(false);
      setSendAmount(false);
      setApiKey('');
    } catch {
      setNotice('Could not remove your API key. Try again.');
    } finally {
      setPending(false);
    }
  };

  // Toggles fire independently via PATCH — never bundled with a key save, so
  // flipping one can never re-submit or overwrite the stored key.
  const handleToggle = async (next: { sendNote: boolean; sendAmount: boolean }): Promise<void> => {
    setPending(true);
    try {
      const response = await fetch('/api/settings/ai/toggles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!response.ok) {
        // Roll the optimistic flip back rather than leaving the switch lying.
        setSendNote(settings.sendNote);
        setSendAmount(settings.sendAmount);
        setNotice('Could not save that setting. Try again.');
        return;
      }
      setSettings((await response.json()) as FrontendAiSettings);
    } catch {
      setSendNote(settings.sendNote);
      setSendAmount(settings.sendAmount);
      setNotice('Could not save that setting. Try again.');
    } finally {
      setPending(false);
    }
  };

  if (!settings.available) {
    return (
      <div className="border-line bg-paper-raised rounded-2xl border p-5">
        <h2 className="font-display text-[15px] font-semibold">AI categorization</h2>
        <p className="text-ink-muted mt-3 text-[13.5px]">
          AI suggestions aren&rsquo;t available on this deployment.
        </p>
      </div>
    );
  }

  return (
    <div className="border-line bg-paper-raised rounded-2xl border p-5">
      <h2 className="font-display text-[15px] font-semibold">AI categorization</h2>
      <p className="text-ink-muted mt-1 text-[12.5px]">
        Bring your own Anthropic or OpenAI key to get on-demand category suggestions in the
        Categorize queue for transactions no rule matches.
      </p>

      {/* Provider selector — pill group, same idiom as Preferences' palette row */}
      <div className="ledger-row flex items-center gap-5 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Provider</div>
          <div className="text-ink-muted mt-0.5 text-[12.5px]">
            Saving a new provider replaces any existing key
          </div>
        </div>
        <div className={pillGroup}>
          {AI_PROVIDERS.map((p) => (
            <button
              key={p}
              type="button"
              disabled={pending}
              onClick={() => setProvider(p)}
              className={pillOption(provider === p, pending)}
            >
              {PROVIDER_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* API key — write-only. Existing key is represented only by the
          masked-value placeholder text, never as a value. */}
      <div className="py-3.5">
        <Label htmlFor="ai-api-key">API key</Label>
        <Input
          id="ai-api-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={settings.configured ? (settings.maskedKey ?? undefined) : 'sk-...'}
        />
        {settings.configured && (
          <p className="text-ink-muted mt-1.5 text-[12.5px]">
            {settings.verified
              ? `${PROVIDER_LABELS[settings.provider!]} key saved and verified.`
              : `${PROVIDER_LABELS[settings.provider!]} key saved — not yet verified (the provider was unreachable at save time).`}
          </p>
        )}
        <div className="mt-3 flex gap-2.5">
          <Button
            type="button"
            onClick={handleSaveClick}
            disabled={apiKey.trim().length < 20}
            loading={pending}
          >
            Save key
          </Button>
          {settings.configured && (
            <Button type="button" variant="danger" onClick={handleRemove} disabled={pending}>
              Remove key
            </Button>
          )}
        </div>
      </div>

      {notice && (
        <p className="bg-rose-soft text-rose mt-1 rounded-lg px-3 py-2 text-[13px]" role="alert">
          {notice}
        </p>
      )}
      {warning && (
        // Informational, not an error (the Q1 outage-tolerant "saved, unverified"
        // state) — ink-muted on a neutral border, deliberately not the rose
        // error treatment. This codebase's palette has no amber/warning token.
        <p
          className="border-line text-ink-muted mt-1 rounded-lg border px-3 py-2 text-[13px]"
          role="status"
        >
          {warning}
        </p>
      )}

      {/* Toggles — visually subordinate to (and disabled without) a configured
          key. Switch idiom cloned verbatim from reminders-section.tsx. */}
      <div
        className={cn('mt-2 border-t pt-3.5', 'border-line', !settings.configured && 'opacity-60')}
      >
        <div className="flex items-center gap-5 py-2">
          <div className="min-w-0 flex-1">
            <div className={cn('text-sm font-medium', !settings.configured && 'text-ink-muted')}>
              Include the transaction note
            </div>
            <div className="text-ink-muted mt-0.5 text-[12.5px]">
              Sent to {PROVIDER_LABELS[provider]} only for the transaction you suggest on
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={sendNote}
            aria-label="Include the transaction note"
            disabled={!settings.configured || pending}
            onClick={() => {
              const next = !sendNote;
              setSendNote(next);
              void handleToggle({ sendNote: next, sendAmount });
            }}
            className={cn(
              'relative h-7 w-12 shrink-0 rounded-full border transition-colors',
              sendNote ? 'bg-iris border-iris' : 'border-line bg-paper-sunk',
              (!settings.configured || pending) && 'opacity-60',
            )}
          >
            <span
              className={cn(
                'bg-paper-raised absolute top-0.5 size-5.5 rounded-full shadow-sm transition-[left]',
                sendNote ? 'left-[22px]' : 'left-0.5',
              )}
            />
          </button>
        </div>
        <div className="flex items-center gap-5 py-2">
          <div className="min-w-0 flex-1">
            <div className={cn('text-sm font-medium', !settings.configured && 'text-ink-muted')}>
              Include the amount
            </div>
            <div className="text-ink-muted mt-0.5 text-[12.5px]">Off by default</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={sendAmount}
            aria-label="Include the amount"
            disabled={!settings.configured || pending}
            onClick={() => {
              const next = !sendAmount;
              setSendAmount(next);
              void handleToggle({ sendNote, sendAmount: next });
            }}
            className={cn(
              'relative h-7 w-12 shrink-0 rounded-full border transition-colors',
              sendAmount ? 'bg-iris border-iris' : 'border-line bg-paper-sunk',
              (!settings.configured || pending) && 'opacity-60',
            )}
          >
            <span
              className={cn(
                'bg-paper-raised absolute top-0.5 size-5.5 rounded-full shadow-sm transition-[left]',
                sendAmount ? 'left-[22px]' : 'left-0.5',
              )}
            />
          </button>
        </div>
        {!settings.configured && (
          <p className="text-ink-muted mt-1 text-[12.5px]" id="ai-toggles-disabled-hint">
            Save an API key to turn these on.
          </p>
        )}
      </div>

      <AiDisclosureModal
        key={dialogKey}
        open={disclosureOpen}
        onClose={() => setDisclosureOpen(false)}
        onAccept={handleDisclosureAccept}
        pending={pending}
        // The modal owns its own GET (it is remounted per open via dialogKey),
        // so there is nothing to pre-fetch here.
        preview={null}
        provider={provider}
      />
    </div>
  );
};
