'use client';

import { useEffect } from 'react';

/**
 * Registers `/sw.js` once per page load. Renders nothing.
 *
 * Registering a worker never prompts for notification permission on its own —
 * only the Settings toggle calls `Notification.requestPermission`. That's what
 * keeps reminders opt-out by default even though every visitor gets the worker.
 */
export const ServiceWorkerRegister = (): null => {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    // Registration failing is never fatal — the app works fine without a worker,
    // it just loses the offline fallback and push delivery.
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  return null;
};
