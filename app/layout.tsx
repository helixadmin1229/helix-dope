import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DOPE - Helix AI",
  description: "AI-powered SaaS idea research engine",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
      </head>
      <body>{children}</body>
    </html>
  );
}