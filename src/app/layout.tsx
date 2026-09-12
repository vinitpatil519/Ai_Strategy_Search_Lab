import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI Strategy Search Lab",
  description:
    "Algorithmic strategy discovery: genetic search over rule-based trading strategies, walk-forward backtesting, regime detection and cluster analysis — entirely in the browser.",
  applicationName: "AI Strategy Search Lab",
  authors: [{ name: "AI Strategy Search Lab" }],
  keywords: [
    "quantitative research",
    "genetic algorithm",
    "backtesting",
    "regime detection",
    "hidden Markov model",
    "t-SNE",
    "strategy clustering",
  ],
  openGraph: {
    title: "AI Strategy Search Lab",
    description:
      "Generate thousands of strategies, backtest across regimes, cluster the survivors.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#08090b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
