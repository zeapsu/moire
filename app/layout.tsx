import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Moiré — turn the page into an experiment",
  description: "Interactive visual explanations generated from academic papers and readable pages.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
