import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  headers: async () => [
    {
      // Baseline hardening for every response: no framing (clickjacking a
      // finance app's forms), no MIME sniffing, and no full URL leaked in the
      // `Referer` on cross-origin navigations.
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    },
    {
      // The service worker is served from `public/`, which Next caches
      // aggressively by default. Pinning it behind an HTTP cache would strand
      // users on an old worker after a deploy, so it revalidates every time.
      source: '/sw.js',
      headers: [
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        { key: 'Service-Worker-Allowed', value: '/' },
      ],
    },
  ],
};

export default nextConfig;
