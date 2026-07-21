import type { Metadata } from "next";
import { IBM_Plex_Mono, STIX_Two_Text } from "next/font/google";
import "./globals.css";

const serif = STIX_Two_Text({
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Moiré — turn the page into an experiment",
  description: "Interactive experiments laid over the original presentation of any readable page.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${serif.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
