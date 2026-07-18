import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Workbench",
  description:
    "A local-first API client for saved requests, reusable authentication, and developer workflows.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
