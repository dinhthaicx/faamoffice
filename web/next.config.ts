import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const siteUrl = process.env.SITE_URL || "http://localhost:3000";
const isHttps = siteUrl.startsWith("https://");

// Content Security Policy without nonces so marketing pages stay static (SSG).
// Next.js needs 'unsafe-inline' for its inline bootstrap scripts in that mode.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isHttps ? ["upgrade-insecure-requests"] : []),
].join("; ");

// Admin announcement editor: its live preview shows external https images,
// stylesheets and fonts (the sandboxed srcdoc preview inherits this policy).
const adminAnnouncementsCsp = csp
  .replace("img-src 'self' data: blob:", "img-src 'self' data: blob: https:")
  .replace("style-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https:")
  .replace("font-src 'self' data:", "font-src 'self' data: https:")
  .concat("; media-src 'self' https:");

// /announcement-frame/{id} serves admin HTML for the desktop app's iframe. It is
// sandboxed into an opaque origin, never runs scripts and must be embeddable, so
// it gets its own headers instead of the site-wide ones (no X-Frame-Options).
// Keep in sync with FRAME_RESPONSE_HEADERS in src/lib/announcement-shared.ts (tested).
const frameHeaders = [
  {
    key: "Content-Security-Policy",
    value:
      "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src https: data:; " +
      "style-src 'unsafe-inline' https:; font-src https: data:; media-src https:; base-uri 'none'; " +
      "form-action 'none'",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  ...(isHttps ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isHttps ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // web/ is a standalone project inside the FaamOffice monorepo: never resolve
  // modules or trace files from the repository root.
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
  experimental: {
    globalNotFound: true,
  },
  async headers() {
    // Headers set here win over the same headers set by route handlers.
    return [
      { source: "/((?!announcement-frame/).*)", headers: securityHeaders },
      { source: "/announcement-frame/:path*", headers: frameHeaders },
      // Later rules override earlier ones for the same key.
      {
        source: "/:locale(vi|en)/admin/announcements/:path*",
        headers: [{ key: "Content-Security-Policy", value: adminAnnouncementsCsp }],
      },
    ];
  },
};

export default nextConfig;
