import type { Metadata } from 'next';
import { Space_Grotesk, Inter, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
});

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'Ledger',
  description: 'A small, honest budget tracker.',
};

const RootLayout = ({ children }: { children: React.ReactNode }): React.ReactElement => (
  <html
    lang="en"
    data-pal="clay"
    className={`${spaceGrotesk.variable} ${inter.variable} ${plexMono.variable} h-full`}
  >
    <body className="flex min-h-full flex-col antialiased">{children}</body>
  </html>
);

export default RootLayout;
