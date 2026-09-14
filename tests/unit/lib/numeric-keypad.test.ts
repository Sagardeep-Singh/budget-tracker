import { describe, expect, it } from 'vitest';
import { KEYPAD_BACKSPACE, applyKeypadInput, isValidKeypadAmount } from '@/lib/ui/numeric-keypad';

describe('applyKeypadInput', () => {
  it('appends digits to a non-trivial value', () => {
    expect(applyKeypadInput('1', '2')).toBe('12');
    expect(applyKeypadInput('12', '3')).toBe('123');
  });

  it('replaces rather than concatenates a leading zero', () => {
    expect(applyKeypadInput('', '5')).toBe('5');
    expect(applyKeypadInput('0', '5')).toBe('5');
    expect(applyKeypadInput('0', '0')).toBe('0');
  });

  it('starts "0." when the decimal point is the first press', () => {
    expect(applyKeypadInput('', '.')).toBe('0.');
  });

  it('appends a decimal point once and ignores further ones', () => {
    expect(applyKeypadInput('12', '.')).toBe('12.');
    expect(applyKeypadInput('12.', '.')).toBe('12.');
    expect(applyKeypadInput('12.5', '.')).toBe('12.5');
  });

  it('caps the fraction at two decimal places', () => {
    expect(applyKeypadInput('1.', '2')).toBe('1.2');
    expect(applyKeypadInput('1.2', '3')).toBe('1.23');
    expect(applyKeypadInput('1.23', '4')).toBe('1.23');
    expect(applyKeypadInput('0.99', '9')).toBe('0.99');
  });

  it('keeps counting integer digits without a cap', () => {
    expect(applyKeypadInput('123456', '7')).toBe('1234567');
  });

  it('removes exactly the last character on backspace, including a trailing dot', () => {
    expect(applyKeypadInput('12.34', KEYPAD_BACKSPACE)).toBe('12.3');
    expect(applyKeypadInput('12.', KEYPAD_BACKSPACE)).toBe('12');
    expect(applyKeypadInput('1', KEYPAD_BACKSPACE)).toBe('');
  });

  it('is a no-op on backspace against an empty value', () => {
    expect(() => applyKeypadInput('', KEYPAD_BACKSPACE)).not.toThrow();
    expect(applyKeypadInput('', KEYPAD_BACKSPACE)).toBe('');
  });

  it('ignores keys that are not digits, a dot, or backspace', () => {
    expect(applyKeypadInput('12', 'a')).toBe('12');
    expect(applyKeypadInput('12', '-')).toBe('12');
    expect(applyKeypadInput('12', '')).toBe('12');
  });
});

describe('isValidKeypadAmount', () => {
  it('rejects empty and zero-valued amounts', () => {
    expect(isValidKeypadAmount('')).toBe(false);
    expect(isValidKeypadAmount('0')).toBe(false);
    expect(isValidKeypadAmount('0.0')).toBe(false);
    expect(isValidKeypadAmount('0.00')).toBe(false);
  });

  it('rejects a trailing decimal point, which only a keypad can produce', () => {
    expect(isValidKeypadAmount('1.')).toBe(false);
    expect(isValidKeypadAmount('0.')).toBe(false);
  });

  it('rejects anything that is not a plain positive decimal', () => {
    expect(isValidKeypadAmount('.')).toBe(false);
    expect(isValidKeypadAmount('.5')).toBe(false);
    expect(isValidKeypadAmount('-1')).toBe(false);
    expect(isValidKeypadAmount('1.234')).toBe(false);
    expect(isValidKeypadAmount('1e3')).toBe(false);
    expect(isValidKeypadAmount('01')).toBe(false);
  });

  it('accepts positive amounts with up to two decimals', () => {
    expect(isValidKeypadAmount('0.01')).toBe(true);
    expect(isValidKeypadAmount('7')).toBe(true);
    expect(isValidKeypadAmount('7.8')).toBe(true);
    expect(isValidKeypadAmount('7.89')).toBe(true);
    expect(isValidKeypadAmount('1234567.89')).toBe(true);
  });
});
