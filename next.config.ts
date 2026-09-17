import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  headers: async () => [
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
