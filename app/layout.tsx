import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StockX Pro GraphQL Playground",
  description: "Test harness for StockX Pro Buying query",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

