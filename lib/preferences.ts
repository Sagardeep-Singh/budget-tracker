export const PALETTES = ['clay', 'cobalt', 'iris'] as const;
export type Palette = (typeof PALETTES)[number];

export const APPEARANCES = ['system', 'light', 'dark'] as const;
export type Appearance = (typeof APPEARANCES)[number];

export const PALETTE_KEY = 'ledger:pal';
export const APPEARANCE_KEY = 'ledger:theme';

export const isPalette = (value: string | null): value is Palette =>
  !!value && (PALETTES as readonly string[]).includes(value);

export const isAppearance = (value: string | null): value is Appearance =>
  !!value && (APPEARANCES as readonly string[]).includes(value);

export const applyPreferences = (palette: Palette, appearance: Appearance): void => {
  const root = document.documentElement;
  root.setAttribute('data-pal', palette);
  if (appearance === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', appearance);
  }
};

// localStorage.setItem doesn't fire a `storage` event in the tab that wrote
// it, so useSyncExternalStore subscribers (below) need an explicit nudge to
// re-read the snapshot after a same-tab write.
const PREFERENCES_EVENT = 'ledger:preferences-changed';

export const savePreferences = (palette: Palette, appearance: Appearance): void => {
  try {
    localStorage.setItem(PALETTE_KEY, palette);
    localStorage.setItem(APPEARANCE_KEY, appearance);
    window.dispatchEvent(new Event(PREFERENCES_EVENT));
  } catch {
    // localStorage unavailable — preference just won't persist across visits.
  }
};

export const subscribeToPreferences = (callback: () => void): (() => void) => {
  window.addEventListener(PREFERENCES_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(PREFERENCES_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
};

export const getPaletteSnapshot = (): Palette => {
  const value = localStorage.getItem(PALETTE_KEY);
  return isPalette(value) ? value : 'clay';
};

export const getAppearanceSnapshot = (): Appearance => {
  const value = localStorage.getItem(APPEARANCE_KEY);
  return isAppearance(value) ? value : 'system';
};

export const getPaletteServerSnapshot = (): Palette => 'clay';
export const getAppearanceServerSnapshot = (): Appearance => 'system';
