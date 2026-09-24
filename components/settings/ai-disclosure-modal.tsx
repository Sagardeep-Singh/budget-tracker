// Modeled on match-transfers-dialog.tsx's Modal usage: remount via `key`
// (dialogKey, owned by the parent) to get a fresh preview fetch every time it
// opens, rather than an effect keyed on `open`.
'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import type { AiDisclosurePreview } from '@/lib/services/aiCategorize';

const PROVIDER_LABELS = { ANTHROPIC: 'Anthropic', OPENAI: 'OpenAI' } as const;

export const AiDisclosureModal = ({
  open,
  onClose,
  onAccept,
  pending,
  preview: previewProp,
  provider,
}: {
  open: boolean;
  onClose: () => void;
  onAccept: () => void;
  pending: boolean;
  // Parent may pass null and let this component fetch on mount (remounted
  // via `key` each open), or pre-fetch and pass it down — developer's call;
  // spec assumes this component owns the GET given the `key` remount.
  preview: AiDisclosurePreview | null;
  provider: 'ANTHROPIC' | 'OPENAI';
}): React.ReactElement => {
  const [preview, setPreview] = useState<AiDisclosurePreview | null>(previewProp);
  const [loadError, setLoadError] = useState(false);

  // The component is remounted on every open (parent's `dialogKey`), so state
  // starts clean — nothing to reset synchronously here, which also keeps this
  // effect free of a cascading setState.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch('/api/settings/ai/disclosure')
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          setLoadError(true);
          return;
        }
        // Showing a blank or stale preview would be worse than showing a retry
        // state: the whole point of this panel is that it is accurate.
        setPreview((await response.json()) as AiDisclosurePreview);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Review what gets sent" className="max-w-lg">
      <p className="text-ink-muted text-sm">
        Each time you tap &ldquo;Suggest with AI,&rdquo; this is exactly what is sent to{' '}
        {PROVIDER_LABELS[provider]} for that one transaction — nothing else, and nothing is sent
        automatically.
      </p>

      {loadError && (
        <p className="bg-rose-soft text-rose mt-3 rounded-lg px-3 py-2 text-[13px]" role="alert">
          Could not load the preview. Try again.
        </p>
      )}

      {!loadError && !preview && (
        <div className="bg-paper-sunk mt-4 h-32 animate-pulse rounded-xl" aria-hidden="true" />
      )}

      {preview && (
        <div className="mt-4">
          {!preview.exampleFromRealTransaction && (
            <p className="text-ink-muted mb-2 text-[12.5px] italic">
              Your Categorize queue is empty right now, so this is a made-up example, not one of
              your transactions.
            </p>
          )}
          <dl className="border-line divide-line divide-y rounded-xl border">
            {preview.fields.map((field) => (
              <div key={field.label} className="flex justify-between gap-3 px-3.5 py-2.5">
                <dt className="text-ink-muted text-[12.5px] font-medium">{field.label}</dt>
                {/* Deliberately not <Money> — this renders the literal string
                    sent in the request body, not a currency figure the user
                    reads as their balance. Wrapping it in <Money> would imply
                    a formatted, tone-colored amount when the point of this
                    panel is showing the raw bytes. */}
                <dd className="text-ink max-w-[60%] truncate text-right text-[13px]">
                  {field.value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-ink-muted mt-2.5 text-[12.5px]">
            Plus the names of all {preview.categoryCount} of your categories, so the model can pick
            one.
          </p>
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2.5">
        <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        {/* autoFocus alone is enough to steer initial dialog focus here instead
            of Modal's own close button; Button doesn't forward a ref. */}
        <Button
          autoFocus
          type="button"
          onClick={onAccept}
          disabled={!preview || loadError}
          loading={pending}
        >
          Looks good, continue
        </Button>
      </div>
    </Modal>
  );
};
