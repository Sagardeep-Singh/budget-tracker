import { describe, expect, it } from 'vitest';
import { sourceCodeUrl } from '@/lib/http/sourceUrl';

const env = (vars: Record<string, string>): NodeJS.ProcessEnv => vars as NodeJS.ProcessEnv;

describe('sourceCodeUrl', () => {
  it('uses SOURCE_CODE_URL when set', () => {
    expect(sourceCodeUrl(env({ SOURCE_CODE_URL: 'https://git.example/fork' }))).toBe(
      'https://git.example/fork',
    );
  });

  it('falls back to the upstream repository when unset', () => {
    expect(sourceCodeUrl(env({}))).toBe('https://github.com/Sagardeep-Singh/budget-tracker');
  });

  it('falls back to the upstream repository when blank', () => {
    expect(sourceCodeUrl(env({ SOURCE_CODE_URL: '  ' }))).toBe(
      'https://github.com/Sagardeep-Singh/budget-tracker',
    );
  });
});
