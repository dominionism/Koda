import type { Metadata } from "next";
import { Syne, Outfit, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const syne = Syne({
  variable: "--font-display",
  subsets: ["latin"],
});

const outfit = Outfit({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Koda — Voice-Native macOS Automation",
  description:
    "Speak and it's done. On-device voice agent for macOS. 250ms latency. 100% local. Zero cloud dependency.",
};

/** Root layout composing global fonts (Syne, Outfit, JetBrains Mono) and noise overlay.
 *
 * Applies font CSS variables to the HTML element and wraps children in the
 * antialiased body with the noise texture overlay class.
 *
 * @param children - React child nodes to render within the layout
 * @returns Full HTML document shell with font variables applied
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${syne.variable} ${outfit.variable} ${jetbrainsMono.variable} noise-overlay antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
