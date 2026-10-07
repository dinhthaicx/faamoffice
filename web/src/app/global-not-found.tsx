// 404 for URLs that match no route at all (outside /vi and /en).
/* eslint-disable @next/next/no-html-link-for-pages -- Full document loads replace the 404's strict CSP. */

import "@fontsource-variable/inter";
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "404 — FaamOffice",
  robots: { index: false, follow: false },
};

export default function GlobalNotFound() {
  return (
    <html lang="vi">
      <body className="flex min-h-screen items-center justify-center p-6">
        <main className="max-w-md text-center">
          <p className="text-gradient text-7xl font-extrabold">404</p>
          <h1 className="mt-4 text-2xl font-bold">Không tìm thấy trang</h1>
          <p lang="en" className="mt-1 text-muted">
            Page not found
          </p>
          <p className="mt-8 flex justify-center gap-4 text-sm">
            {/* Reload the document so the destination receives its own CSP. */}
            <a href="/vi" className="font-semibold text-link hover:underline">
              Trang chủ
            </a>
            <a href="/en" lang="en" className="font-semibold text-link hover:underline">
              Home
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}
