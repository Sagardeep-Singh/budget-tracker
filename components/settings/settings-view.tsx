'use client';

import { useSyncExternalStore } from 'react';
import { cn } from '@/lib/cn';
import {
  APPEARANCES,
  PALETTES,
  getAppearanceServerSnapshot,
  getAppearanceSnapshot,
  getPaletteServerSnapshot,
  getPaletteSnapshot,
  savePreferences,
  subscribeToPreferences,
  type Appearance,
  type Palette,
} from '@/lib/preferences';

const PALETTE_LABELS: Record<Palette, string> = { clay: 'Clay', cobalt: 'Cobalt', iris: 'Iris' };
const APPEARANCE_LABELS: Record<Appearance, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

const pillGroup = 'flex gap-1.5';
const pillOption = (active: boolean): string =>
  cn(
    'rounded-full border px-3.5 py-2 text-[13px] font-medium',
    active ? 'bg-iris border-iris text-paper-raised' : 'border-line text-ink',
  );

export const SettingsView = ({ email }: { email: string }): React.ReactElement => {
  const palette = useSyncExternalStore(
    subscribeToPreferences,
    getPaletteSnapshot,
    getPaletteServerSnapshot,
  );
  const appearance = useSyncExternalStore(
    subscribeToPreferences,
    getAppearanceSnapshot,
    getAppearanceServerSnapshot,
  );

  return (
    <div className="mt-6.5 flex flex-col gap-4">
      <div className="border-line bg-paper-raised rounded-2xl border p-5">
        <h2 className="font-display text-[15px] font-semibold">Account</h2>
        <div className="ledger-row flex items-center gap-5 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Email</div>
            <div className="text-ink-muted mt-0.5 text-[12.5px]">Signed in as</div>
          </div>
          <span className="text-ink-muted shrink-0 rounded-full px-3.5 py-2 text-[13px]">
            {email}
          </span>
        </div>
      </div>

      <div className="border-line bg-paper-raised rounded-2xl border p-5">
        <h2 className="font-display text-[15px] font-semibold">Preferences</h2>
        <div className="ledger-row flex items-center gap-5 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Accent</div>
            <div className="text-ink-muted mt-0.5 text-[12.5px]">Ledger&rsquo;s color palette</div>
          </div>
          <div className={pillGroup}>
            {PALETTES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => savePreferences(p, appearance)}
                className={pillOption(palette === p)}
              >
                {PALETTE_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-5 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Appearance</div>
            <div className="text-ink-muted mt-0.5 text-[12.5px]">
              Light, dark, or match your device
            </div>
          </div>
          <div className={pillGroup}>
            {APPEARANCES.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => savePreferences(palette, a)}
                className={pillOption(appearance === a)}
              >
                {APPEARANCE_LABELS[a]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
