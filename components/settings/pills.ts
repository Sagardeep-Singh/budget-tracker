import { cn } from '@/lib/cn';

/**
 * The Settings card pill language, shared by the Preferences card
 * (palette/appearance) and the Reminders card (cadence) so the two rows stay
 * visually identical without either file importing the other.
 */
export const pillGroup = 'flex flex-wrap justify-end gap-1.5';

export const pillOption = (active: boolean, disabled = false): string =>
  cn(
    'rounded-full border px-3.5 py-2 text-[13px] font-medium',
    active ? 'bg-iris border-iris text-paper-raised' : 'border-line text-ink',
    disabled && 'cursor-not-allowed opacity-45',
  );
