// A dumb, presentational button — all fetch/state ownership lives in
// categorize-view.tsx per its existing pattern (confirm/skip are owned by the
// parent too, rows just call back up).
'use client';

import { useId } from 'react';
import { Loader2, Sparkles } from 'lucide-react';

export type SuggestAiButtonState = 'idle' | 'loading' | 'error' | 'unavailable';

export const SuggestAiButton = ({
  state,
  disabledReason,
  onClick,
  compact = false,
}: {
  state: SuggestAiButtonState;
  // Non-null only when the button is disabled for a reason the user can act
  // on (no key configured, disclosure pending, daily cap hit). Rendered as
  // visible text via aria-describedby, not a title-attribute tooltip — this
  // codebase has no tooltip primitive.
  disabledReason: string | null;
  onClick: () => void;
  // Icon-only at the fixed-width desktop table row; icon+label everywhere
  // else (grouped cards, mobile cards).
  compact?: boolean;
}): React.ReactElement => {
  const disabled = state === 'loading' || state === 'unavailable' || disabledReason !== null;
  const hintId = useId();

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        // Always present, so the compact icon-only variant is still named.
        aria-label="Suggest with AI"
        aria-describedby={disabledReason ? hintId : undefined}
        aria-busy={state === 'loading'}
        className="border-line text-ink inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === 'loading' ? (
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles size={14} aria-hidden="true" />
        )}
        {state === 'loading' ? 'Asking…' : compact ? null : 'Suggest with AI'}
      </button>
      {disabledReason && (
        <span id={hintId} className="text-ink-muted text-[11.5px]">
          {disabledReason}
        </span>
      )}
    </>
  );
};
