import type { MetadataRoute } from 'next';

/**
 * Typed manifest route — Next links it from every page automatically, so there's
 * no `app/layout.tsx` metadata edit, and it sits next to the existing
 * `app/icon.svg` / `app/apple-icon.tsx`.
 *
 * `start_url` is `/dashboard` rather than `/`: an installed app should land in the
 * app shell, and the protected layout already bounces a signed-out visitor to
 * `/login`, so the unauthenticated case still works.
 *
 * Colors are the Clay (default) palette's `--paper` and `--iris` tokens from
 * `app/globals.css`; the manifest can't read CSS variables, so they're duplicated
 * literally here.
 */
const manifest = (): MetadataRoute.Manifest => ({
  name: 'Ledger',
  short_name: 'Ledger',
  description: 'A small, honest budget tracker.',
  start_url: '/dashboard',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#f6f2ee',
  theme_color: '#a8622a',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    {
      // Separate maskable art with the safe-zone padding Android's adaptive icon
      // crop expects — reusing the `any` icon here would clip the ring mark.
      src: '/icons/icon-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
});

export default manifest;
