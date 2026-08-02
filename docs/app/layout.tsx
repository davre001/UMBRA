import type { Metadata } from 'next';
import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import { Head } from 'nextra/components';
import { getPageMap } from 'nextra/page-map';
import { Space_Grotesk } from 'next/font/google';
import Image from 'next/image';
import 'nextra-theme-docs/style.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['700'],
});

export const metadata: Metadata = {
  title: {
    default: 'Umbra Docs',
    template: '%s | Umbra Docs',
  },
  description:
    'Documentation for Umbra Protocol — a privacy-preserving dark pool for FAssets on the Flare Network.',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
  },
};

const navbar = (
  <Navbar
    logo={
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
        <Image src="/logo.png" alt="" width={28} height={28} priority />
        <span
          className={spaceGrotesk.className}
          style={{
            fontWeight: 700,
            letterSpacing: '0.1em',
            fontSize: '1.125rem',
            lineHeight: 1,
          }}
        >
          UMBRA Docs
        </span>
      </span>
    }
    projectLink="https://github.com/davre001/UMBRA"
  />
);

const footer = (
  <Footer>
    <span>
      MIT {new Date().getFullYear()} &copy; Umbra Protocol — running on Flare Coston2 testnet.
    </span>
  </Footer>
);

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head backgroundColor={{ dark: '#0a0a0a', light: '#fafafa' }} />
      <body>
        <Layout
          navbar={navbar}
          footer={footer}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/davre001/UMBRA/tree/main/docs"
          editLink="Edit this page on GitHub"
          nextThemes={{ defaultTheme: 'dark' }}
          sidebar={{ defaultMenuCollapseLevel: 1 }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
