'use client';

import { Delete } from 'lucide-react';
import { KEYPAD_BACKSPACE, KEYPAD_DECIMAL, applyKeypadInput } from '@/lib/ui/numeric-keypad';
import { cn } from '@/lib/cn';

type Key = { key: string; label: React.ReactNode; ariaLabel?: string };

const KEYS: Key[] = [
  { key: '1', label: '1' },
  { key: '2', label: '2' },
  { key: '3', label: '3' },
  { key: '4', label: '4' },
  { key: '5', label: '5' },
  { key: '6', label: '6' },
  { key: '7', label: '7' },
  { key: '8', label: '8' },
  { key: '9', label: '9' },
  { key: KEYPAD_DECIMAL, label: '.', ariaLabel: 'Decimal point' },
  { key: '0', label: '0' },
  { key: KEYPAD_BACKSPACE, label: <Delete size={18} />, ariaLabel: 'Delete last digit' },
];

/**
 * Controlled 3×4 amount keypad. All value transitions live in
 * `lib/ui/numeric-keypad.ts` so they stay unit-testable.
 */
export const NumericKeypad = ({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
}): React.ReactElement => (
  <div className={cn('grid grid-cols-3 gap-2', className)}>
    {KEYS.map((k) => (
      <button
        key={k.key}
        type="button"
        aria-label={k.ariaLabel}
        onClick={() => onChange(applyKeypadInput(value, k.key))}
        className="border-line bg-paper-raised text-ink focus-visible:outline-iris flex h-14 min-h-[44px] items-center justify-center rounded-xl border font-mono text-xl focus-visible:outline-2 focus-visible:outline-offset-2 active:opacity-70"
      >
        {k.label}
      </button>
    ))}
  </div>
);
