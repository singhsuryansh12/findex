import type { Metadata } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

const dmSans = localFont({
  src: "./fonts/dm-sans-latin.woff2",
  variable: "--font-dm-sans",
  weight: "100 1000",
  display: "swap",
});

const instrumentSerif = localFont({
  src: [
    { path: "./fonts/instrument-serif-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/instrument-serif-italic-latin.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-instrument-serif",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://findex-financial-os.vercel.app"),
  title: "FinDex — Your financial life, anticipated",
  description:
    "An AI-native financial operating system with predictive cashflow and tools built live by Codex.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "64x64" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
  },
  openGraph: {
    title: "FinDex — Your financial life, anticipated",
    description: "Predict cashflow, ask your money questions, and build the tools you need.",
    type: "website",
    images: [{ url: "/findex-og.png", width: 1200, height: 630, alt: "FinDex — Money, anticipated" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FinDex — Your financial life, anticipated",
    description: "Predict cashflow, ask your money questions, and build the tools you need.",
    images: ["/findex-og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <body
        className={`${dmSans.variable} ${instrumentSerif.variable} antialiased`}
      >
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
