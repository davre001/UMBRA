import type { Metadata } from 'next';
import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import { Head } from 'nextra/components';
import { getPageMap } from 'nextra/page-map';
import Image from 'next/image';
import 'nextra-theme-docs/style.css';

export const metadata: Metadata = {
  title: {
    default: 'Umbra Protocol Docs',
    template: '%s | Umbra Protocol',
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
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Image src="/logo.svg" alt="" width={24} height={24} />
        <b>Umbra</b>
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
