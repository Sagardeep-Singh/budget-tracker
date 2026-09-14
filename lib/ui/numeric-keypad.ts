/**
 * Pure value-transition logic for the mobile amount keypad, kept out of the
 * component so it is unit-testable under vitest's `environment: 'node'`
 * (same precedent as `lib/dashboard/day-bars.ts`).
 */

export const KEYPAD_BACKSPACE = 'backspace';
export const KEYPAD_DECIMAL = '.';

const MAX_DECIMALS = 2;

/**
 * Applies a single keypad press to the current amount string.
 * `key` is a digit '0'-'9', '.', or KEYPAD_BACKSPACE.
 */
export const applyKeypadInput = (value: string, key: string): string => {
  if (key === KEYPAD_BACKSPACE) {
    // Backspace on an empty value is a no-op rather than an error — the
    // keypad has no "disabled" state for it.
    return value.slice(0, -1);
  }

  if (key === KEYPAD_DECIMAL) {
    if (value.includes(KEYPAD_DECIMAL)) return value;
    return value === '' ? '0.' : `${value}.`;
  }

  if (!/^[0-9]$/.test(key)) return value;

  // A leading zero is replaced, not concatenated: '0' + '5' is '5', not '05'.
  if (value === '' || value === '0') return key;

  const decimalIndex = value.indexOf(KEYPAD_DECIMAL);
  if (decimalIndex !== -1 && value.length - decimalIndex - 1 >= MAX_DECIMALS) return value;

  return `${value}${key}`;
};

/**
 * Whether the keypad's current string is a saveable amount. A keypad can
 * produce a trailing decimal point ('1.'), which a native number input never
 * can — that state must not reach the API.
 */
export const isValidKeypadAmount = (value: string): boolean => {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(value)) return false;
  return Number(value) > 0;
};
