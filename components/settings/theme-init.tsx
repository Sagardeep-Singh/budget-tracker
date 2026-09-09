'use client';

import { useLayoutEffect, useSyncExternalStore } from 'react';
import {
  applyPreferences,
  getAppearanceServerSnapshot,
  getAppearanceSnapshot,
  getPaletteServerSnapshot,
  getPaletteSnapshot,
  subscribeToPreferences,
} from '@/lib/preferences';

/**
 * Re-applies the viewer's saved palette/appearance to <html> whenever
 * Settings changes them, and on mount. The inline script in app/layout.tsx
 * already applies the saved values before first paint (avoiding a flash of
 * the server default) — this component's mount-time run exists to survive
 * React Strict Mode's dev remount, which resets <html> to only the
 * attributes it manages from JSX and clears whatever the script set; it's
 * a no-op in production, where the script's attribute is still there.
 * useLayoutEffect (not useEffect) so that re-apply also happens before
 * paint rather than after. Subscribes via useSyncExternalStore rather than
 * reading localStorage directly, so there's no synchronous setState-in-effect
 * and no hydration mismatch — the server snapshot is the Clay/system
 * default already on <html>, and this only touches attributes (not React
 * state).
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

  useLayoutEffect(() => {
    applyPreferences(palette, appearance);
  }, [palette, appearance]);

  return null;
};
