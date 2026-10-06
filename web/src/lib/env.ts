// Server-side configuration read from environment variables. Values are parsed
// lazily so `next build` works without a full production environment.

export type ServerConfig = {
  siteUrl: string;
  siteOrigin: string;
  isProduction: boolean;
  cookieSecure: boolean;
  signupBonusCredits: number;
  adminEmails: Set<string>;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    pass?: string;
    from: string;
  } | null;
  ai: {
    upstreamBaseUrl: string | null;
    upstreamApiKey: string | null;
    modelsJson: string | undefined;
    requestTimeoutMs: number;
  };
};

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function int(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Normalized public base URL of the site, without a trailing slash. */
export function getSiteUrl(): string {
  const raw = (process.env.SITE_URL || "http://localhost:3000").trim();
  try {
    const url = new URL(raw);
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch {
    return "http://localhost:3000";
  }
}

export function parseEmailList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function getConfig(): ServerConfig {
  const siteUrl = getSiteUrl();
  const siteOrigin = new URL(siteUrl).origin;
  const smtpHost = process.env.SMTP_HOST?.trim();
  const upstream = process.env.FAAM_AI_UPSTREAM_BASE_URL?.trim();
  return {
    siteUrl,
    siteOrigin,
    isProduction: process.env.NODE_ENV === "production",
    cookieSecure: bool(process.env.COOKIE_SECURE, siteUrl.startsWith("https://")),
    signupBonusCredits: Math.max(0, int(process.env.SIGNUP_BONUS_CREDITS, 100)),
    adminEmails: parseEmailList(process.env.ADMIN_EMAILS),
    smtp: smtpHost
      ? {
          host: smtpHost,
          port: int(process.env.SMTP_PORT, 587),
          secure: bool(process.env.SMTP_SECURE, int(process.env.SMTP_PORT, 587) === 465),
          user: process.env.SMTP_USER || undefined,
          pass: process.env.SMTP_PASS || undefined,
          from: process.env.MAIL_FROM || `FaamOffice <no-reply@${new URL(siteUrl).hostname}>`,
        }
      : null,
    ai: {
      upstreamBaseUrl: upstream ? upstream.replace(/\/+$/, "") : null,
      upstreamApiKey: process.env.FAAM_AI_UPSTREAM_API_KEY?.trim() || null,
      modelsJson: process.env.FAAM_AI_MODELS,
      requestTimeoutMs: Math.max(10_000, int(process.env.FAAM_AI_REQUEST_TIMEOUT_MS, 600_000)),
    },
  };
}
