import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "@/providers/providers";
import { WebGLBackground } from "@/components/shared/web-gl-background";
import "./globals.css";

// Vendored locally rather than fetched from Google at build time (see
// fonts/ in this directory) — a build-time network fetch is a fragility a
// CI/Vercel build shouldn't depend on. Same latin-subset glyph coverage and
// weights (300/400/500/600) the previous next/font/google config used;
// Inter's own latin subset ships as one variable-weight file rather than
// four separate static ones, which is what Google itself now serves.
const inter = localFont({
  src: "./fonts/Inter-Variable.woff2",
  variable: "--font-inter",
  weight: "300 400 500 600",
  display: "swap",
});

const spaceGrotesk = localFont({
  src: "./fonts/SpaceGrotesk-Bold.woff2",
  variable: "--font-space-grotesk",
  weight: "700",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Umbra Protocol | Privacy-Preserving Dark Pool",
  description: "Institutional-grade secure dark pool built on Flare Network. Complete private trading, stealth payments, and shielded liquidity.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/logo.png", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-bg-base text-text-primary flex flex-col selection:bg-accent-primary/20 selection:text-accent-primary relative">
        <Providers>
          <div className="fixed inset-0 z-0 pointer-events-none">
            <WebGLBackground />
          </div>
          <div className="relative z-10 flex flex-col min-h-screen">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
