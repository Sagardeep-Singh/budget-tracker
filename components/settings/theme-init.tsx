'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  applyPreferences,
  getAppearanceServerSnapshot,
  getAppearanceSnapshot,
  getPaletteServerSnapshot,
  getPaletteSnapshot,
  subscribeToPreferences,
} from '@/lib/preferences';

/**
 * Applies the viewer's saved palette/appearance to <html> on every page
 * load and whenever Settings changes them. Subscribes via
 * useSyncExternalStore rather than reading localStorage in an effect, so
 * there's no synchronous setState-in-effect and no hydration mismatch —
 * the server snapshot is the Clay/system default already on <html>, and
 * this only touches attributes (not React state), so a returning visitor
 * with a different saved preference sees it applied as soon as this
 * component runs, no extra render involved.
 */
export const ThemeInit = (): null => {
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

  useEffect(() => {
    applyPreferences(palette, appearance);
  }, [palette, appearance]);

  return null;
};
