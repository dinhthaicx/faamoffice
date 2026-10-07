# FaamOffice web

Website and account backend for [FaamOffice](../README.md): bilingual marketing site
(Vietnamese default, English), web accounts, desktop sign-in (device code flow),
usage history, an admin dashboard with site settings, and **Faam AI Cloud** — an
OpenAI-compatible AI proxy using the server's upstream key, billed in credits or
(when an admin turns credits off) free for signed-in users with an optional
daily request limit.

Standalone Next.js project (own `package.json` / `package-lock.json`); it is not
part of the monorepo's npm workspaces. Run every npm command inside `web/`.

- Next.js 16 (App Router, Turbopack, server components) · React 19 · Tailwind CSS 4
- Prisma 7 + SQLite (better-sqlite3 driver adapter) · zod · nodemailer · vitest
- Passwords: node:crypto scrypt. Sessions: DB-backed, httpOnly cookie.

## Quick start

```bash
cd web
cp .env.example .env
npm install                 # also runs `prisma generate`
npx prisma migrate dev      # creates data/faamoffice.db
npm run dev                 # http://localhost:3000
```

Without SMTP settings, verification and password-reset emails are printed to the
server console. Without `FAAM_AI_UPSTREAM_BASE_URL`, Faam AI Cloud answers 503.

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server (`PORT` or `-p`) |
| `npm run lint` | ESLint (Next.js core-web-vitals + TypeScript rules) |
| `npm run typecheck` | `prisma generate`, `next typegen`, `tsc --noEmit` |
| `npm test` | Unit + SQLite integration tests (vitest) |
| `npm run smoke` | End-to-end smoke test against a running server (see below) |
| `npm run db:migrate` | `prisma migrate deploy` (production) |
| `npm run db:seed` | Create/promote the admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` |
| `npm run make-admin -- you@example.com` | Grant ADMIN (`--revoke` to remove) |

## Environment variables

All variables are documented in [`.env.example`](.env.example). `[build]` ones are
inlined into static pages at build time — rebuild after changing them.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SITE_URL` [build] | `http://localhost:3000` | Public base URL: canonical/hreflang/OG/sitemap, email links, `verification_uri` |
| `NEXT_PUBLIC_GITHUB_REPO` [build] | `dinhthaicx/faamoffice` | Repo whose GitHub Releases provide installers |
| `GITHUB_TOKEN` | – | Optional, avoids GitHub API rate limits for the download page |
| `DATABASE_URL` | `file:./data/faamoffice.db` | SQLite file (or PostgreSQL URL after switching) |
| `SIGNUP_BONUS_CREDITS` | `100` | Credits for new accounts (ledger reason `signup_bonus`; granted in both credit modes, only shown while credits are on) |
| `ADMIN_EMAILS` | – | Comma-separated emails promoted to ADMIN at registration/login |
| `COOKIE_SECURE` | `true` when `SITE_URL` is https | Secure session cookie (`__Host-fo_session`) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | – | Used by `npm run db:seed` |
| `SEED_CREDITS_ENABLED` / `SEED_AI_DAILY_LIMIT` | – | Optional for `npm run db:seed`: set the Faam credits mode (`true`/`false`) and the daily request limit (`0` = unlimited), like the admin Settings page |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | – | Outgoing email; console fallback when `SMTP_HOST` is empty |
| `FAAM_AI_UPSTREAM_BASE_URL` | – | OpenAI-compatible base URL (enables Faam AI Cloud) |
| `FAAM_AI_UPSTREAM_API_KEY` | – | Upstream key (optional for local servers) |
| `FAAM_AI_MODELS` | `faam-fast`, `faam-pro` | JSON model catalog and prices (below) |
| `FAAM_AI_REQUEST_TIMEOUT_MS` | `600000` | Upstream timeout |

## Admins

1. Put the email in `ADMIN_EMAILS` before the person registers or signs in, **or**
2. `npm run make-admin -- you@example.com` after they registered, **or**
3. Set `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` and run `npm run db:seed`.

The admin page (`/vi/admin`, `/en/admin`) lists and searches users, shows stats
(users, signed-in devices, credits used in 7/30 days), adjusts credits (+/−
with a mandatory reason, written to the ledger) and disables/enables accounts.
Disabled users cannot sign in, their browser sessions are deleted and their
desktop tokens are rejected until the account is enabled again. There is no
payment gateway: admins add credits manually. While Faam credits are off (see
Settings) the dashboard, user list and user page show request/token counts
instead of credits; the adjustment form keeps working (balances are preserved).

### Settings (Faam credits, follow channels)

`/vi/admin/settings` (`/en/…`, tab "Cài đặt" / "Settings") holds the site-wide
settings, stored in the `SiteSetting` table (one JSON row per key, validated with
defaults in `src/lib/site-settings.ts`; reads are cached for ~10 s per process
and fall back to the defaults on any database error, retried after ~1 s; a
stored social link that no longer validates is dropped on its own, not the
whole list):

| Setting | Default | Effect |
| --- | --- | --- |
| `creditsEnabled` | `true` | **On**: every Faam AI Cloud request is charged in credits; an empty balance gets 402. **Off**: signing in is all a user needs — no balance check, no charge, no ledger entry (usage is still recorded with 0 credits) and no credit UI on the website or in the app. Turning it back on restores charging; balances and ledgers are untouched. |
| `aiDailyRequestLimit` | `300` | Only while credits are off: Faam AI requests per user per day (0 = unlimited). A day is a calendar day in Asia/Ho_Chi_Minh (fixed UTC+7); the count is the user's usage records since local midnight plus their requests still running on this server process. Soft limit: a request finishing at the moment another is checked can let one extra through, and requests that produced no output are not counted. FaamOffice 0.11.1 and older show the limit as "AI service busy" (see the API contract, §3). |
| `socialLinks` | `[]` | Up to 12 follow buttons `{ id, platform, url, label?, enabled }`, in display order: shown at the bottom of every website page and in the desktop app (above Settings in the Home sidebar). |

Social platforms and the hosts their https URLs must use (subdomains allowed):
`facebook` (facebook.com, fb.com, fb.me), `youtube` (youtube.com, youtu.be),
`tiktok` (tiktok.com), `zalo` (zalo.me), `x` (x.com, twitter.com), `instagram`
(instagram.com), `threads` (threads.net, threads.com), `telegram` (t.me,
telegram.me), `discord` (discord.gg, discord.com), `github` (github.com),
`linkedin` (linkedin.com) and `website` (any https URL). Labels are optional (≤ 40
characters); ids are short stable strings generated when a link is added.

Public pages are prerendered: the footer is built from the settings read at
build time (the defaults when the database is unreachable then, e.g. in a Docker
build). Saving the settings revalidates every page under the `[locale]` layout,
so the website updates on the next visit; the layout also revalidates hourly so
a build without database access catches up on its own.

### Announcements (in-app dialogs)

`/vi/admin/announcements` (`/en/…`, tab "Thông báo" / "Announcements" in the
admin navigation) manages the dialogs the desktop app shows when it starts:

1. **New announcement** → choose the type: *Image and text* (`rich`: optional
   image, title, plain-text body, link button — laid out by the app) or *HTML
   page* (`html`: your own HTML, shown in a sandboxed frame).
2. Pick the level (`info` / `warning` / `critical`) and the display mode:
   `once` (one time per device), `every_launch` (every start while active) or
   `until_dismissed` (every start until the user ticks "don't show again").
3. Write the Vietnamese title (required) and optionally English; empty English
   fields fall back to Vietnamese. For images either upload one (PNG/JPEG/WebP/GIF,
   ≤ 2 MB, type checked by magic bytes) or paste an `https://` URL. Links must be https.
   Image fields only apply to *Image and text*: an *HTML page* ignores them and
   drops them (and deletes the upload) when saved. The button label defaults to
   "Xem chi tiết" / "Learn more" only when both labels are empty.
4. Target platforms (none = all), an inclusive version range (`x.y.z`), the
   display window (start defaults to now, no end = forever) and a priority
   (−1000…1000, higher first). The live preview shows the dialog in vi/en.
5. Save as draft or published; the list offers publish/unpublish, edit and
   delete (with confirmation). Apps receive changes within about a minute
   (public responses are cacheable for 60 s).

HTML announcements never run scripts: they are served from
`/announcement-frame/{id}` with `Content-Security-Policy: sandbox allow-popups
allow-popups-to-escape-sandbox; default-src 'none'; …` (no `script-src`, no
`allow-same-origin`), so the page lives in an opaque origin and cannot read
faamoffice.net cookies. Images, stylesheets, fonts and media must use https;
forms cannot submit; links open outside the frame (`<base target="_blank">`).
Unused uploads are deleted when an announcement drops its image, when it is
deleted, and (for abandoned uploads) after 24 hours.

## Faam AI Cloud upstream

The proxy forwards `/api/v1/ai/chat/completions` to
`${FAAM_AI_UPSTREAM_BASE_URL}/chat/completions`. `FAAM_AI_MODELS` maps public ids
to upstream models and sets prices in **credits per 1,000 tokens**:

```bash
FAAM_AI_MODELS='[{"id":"faam-fast","upstream":"gpt-5-mini","inputPer1K":1,"outputPer1K":4,"maxOutputTokens":32768}]'
```

Cost of a request = `ceil(prompt/1000 × inputPer1K + completion/1000 × outputPer1K)`
(0 for free models). Prices may be fractional.

| Upstream | `FAAM_AI_UPSTREAM_BASE_URL` | `FAAM_AI_UPSTREAM_API_KEY` | Example `upstream` |
| --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `sk-…` | `gpt-5-mini` |
| OpenRouter | `https://openrouter.ai/api/v1` | `sk-or-…` | `anthropic/claude-sonnet-4.5`, `qwen/qwen3-235b-a22b` |
| Ollama (local) | `http://localhost:11434/v1` | empty | `qwen3` (after `ollama pull qwen3`) |

Pick upstream models that support tool calling — Faam AI edits documents through tools.

## Production

```bash
npm ci
SITE_URL=https://faamoffice.example npm run build
npm run db:migrate
SITE_URL=https://faamoffice.example npm start -- -p 3000
```

- Serve over HTTPS behind a reverse proxy (nginx, Caddy…) that appends
  `X-Forwarded-For`; rate limiting keys on the right-most entry. HSTS and
  `upgrade-insecure-requests` are enabled automatically when `SITE_URL` is https.
- Run a **single instance**: rate limits are in-memory (per process) and SQLite
  is a local file. Use PostgreSQL plus a shared limiter (e.g. Redis) to scale out.
- `/api/health` checks the database (used by the Docker healthcheck).

### Docker

```bash
cp .env.example .env          # set SITE_URL, SMTP_*, FAAM_AI_*, ADMIN_EMAILS
docker compose up -d --build  # SITE_URL / NEXT_PUBLIC_GITHUB_REPO become build args
docker compose exec web npm run make-admin -- you@example.com
```

The image runs `prisma migrate deploy` on start and keeps SQLite in the
`faam-data` volume (`/app/data`).

### Switching to PostgreSQL

1. `npm install @prisma/adapter-pg@7.10.0`
2. `prisma/schema.prisma`: `provider = "postgresql"`.
3. `src/lib/db.ts`: replace the adapter with
   ```ts
   import { PrismaPg } from "@prisma/adapter-pg";
   const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
   ```
4. Migrations are provider-specific: move `prisma/migrations` aside and create a
   new baseline with `DATABASE_URL=postgresql://… npx prisma migrate dev --name init`.
5. Optional: make the admin name search case-insensitive by adding
   `mode: "insensitive"` to the `contains` filters in `src/app/[locale]/admin/page.tsx`
   (emails are stored lowercase already).

Docker users can uncomment the `db` service in `docker-compose.yml`.

## Desktop app API (contract)

Base URL = `SITE_URL`. JSON in/out. Errors are `{ "error": "<code>", "message": "<human text>" }`
unless noted. These endpoints never use cookies and need no CORS.

### 1. Device authorization (RFC 8628 style)

`POST /api/auth/device/code` — body `{ "client_id": "faamoffice-desktop", "device_name": "<string ≤ 80>" }`

```json
{ "device_code": "…", "user_code": "BCDF-GHJK", "verification_uri": "https://site/device",
  "verification_uri_complete": "https://site/device?code=BCDF-GHJK", "expires_in": 600, "interval": 5 }
```

`user_code` uses the consonant alphabet `BCDFGHJKLMNPQRSTVWXZ`; `device_code` is
stored hashed. Other `client_id` → 400 `invalid_client`. Longer device names are
trimmed to 80 characters.

`/device` (→ `/vi/device` or `/en/device` by language) asks the user to sign in
(and returns there), shows the code and device name, and offers Approve / Deny.

`POST /api/auth/device/token` — body `{ "client_id": "faamoffice-desktop", "device_code": "…" }`

- 400 `{ "error": "authorization_pending" | "slow_down" | "expired_token" | "access_denied" | "invalid_grant" }`
  (`message` also present; `slow_down` includes the new `interval`). Polling
  faster than the interval (1 s tolerance) returns `slow_down` and raises the
  interval by 5 s, as RFC 8628 requires — clients must add 5 s after each `slow_down`.
- 200 exactly once, then the device code is consumed (`invalid_grant` afterwards):
  ```json
  { "access_token": "fo_<43 chars>", "token_type": "Bearer", "user": { "id": "…", "email": "…", "name": "…" } }
  ```
  Tokens are 32 random bytes, stored as SHA-256 with name = device name,
  `createdAt`, `lastUsedAt`, `revokedAt`.

Form-encoded bodies (`application/x-www-form-urlencoded`) are accepted too.

### 2. Bearer endpoints (`Authorization: Bearer fo_…`)

Missing/unknown/revoked token or disabled user → 401 `{ "error": "invalid_token", … }`.
`lastUsedAt` is updated at most once per minute.

| Endpoint | Response |
| --- | --- |
| `GET /api/v1/me` | `{ id, email, name, emailVerified, role, creditsEnabled, credits?, aiQuota?, createdAt }` (below) |
| `POST /api/v1/logout` | 204, revokes the calling token |
| `GET /api/v1/usage?limit=20&cursor=<id>` | `{ creditsEnabled, items: [{ id, createdAt, model, promptTokens, completionTokens, credits }], nextCursor }` (newest first, `limit` 1–100, `nextCursor` null on the last page; `credits` is 0 for requests made while credits were off) |
| `GET /api/v1/ai/models` | `{ object: "list", data: [{ id, object: "model", owned_by: "faam" }] }` |
| `POST /api/v1/ai/chat/completions` | OpenAI-compatible proxy (below) |

`/api/v1/me` depends on the Faam credits mode (admin Settings):

```json
{ "id": "…", "email": "…", "name": "…", "emailVerified": true, "role": "USER",
  "creditsEnabled": true, "credits": 95, "createdAt": "…" }
{ "id": "…", "email": "…", "name": "…", "emailVerified": true, "role": "USER",
  "creditsEnabled": false, "aiQuota": { "limit": 300, "used": 12, "resetsAt": "2026-10-07T17:00:00.000Z" }, "createdAt": "…" }
```

- `credits` is present only while credits are on (older servers send it without
  `creditsEnabled`: treat a missing `creditsEnabled` as `true`).
- `aiQuota` is present only while credits are off **and** a daily limit is set:
  `used` requests since local midnight (Asia/Ho_Chi_Minh, UTC+7), and `resetsAt`,
  the next local midnight as an ISO instant. No `aiQuota` with credits off = unlimited.

### 3. `POST /api/v1/ai/chat/completions`

The app uses base URL `${SITE_URL}/api/v1/ai` and appends `/chat/completions`.

- Body forwarded unchanged except: `model` mapped to the upstream id,
  `stream_options: { include_usage: true }` added when `stream: true`, and
  `max_tokens` / `max_completion_tokens` capped by `maxOutputTokens`. `tools`,
  `tool_choice`, tool-call deltas and images (data URLs) pass through untouched.
- `stream: true` → SSE passthrough, chunks piped as they arrive (the final usage
  chunk with `choices: []` is passed through as well); otherwise the upstream JSON.
- Unknown model → 400 `{ "error": "model_not_found", "message": … }`.
- Per-user burst limit, in both credit modes: more than 60 requests per minute →
  429 `{ "error": { "message": …, "type": "rate_limited", "code": "rate_limited" } }`
  with `Retry-After` (seconds). Clients should treat it as "busy, retry shortly".
- Credits on, balance ≤ 0 → 402 `{ "error": { "message": "Your Faam AI credits are insufficient. Ask an administrator to add credits.", "type": "insufficient_credits", "code": "insufficient_credits" } }`.
- Credits off, daily limit reached → 429 `{ "error": { "message": "You have used all N Faam AI requests for today. …", "type": "daily_limit_reached", "code": "daily_limit_reached" } }`
  with `Retry-After` = seconds until the next local midnight (UTC+7). The upstream
  is not called. The count is the day's usage records plus the user's requests
  still running (in memory, per server process), so a burst of long streams
  cannot get past it. Soft limit: a request finishing at the moment another is
  checked can let one extra through, and a request that produced no output
  (upstream error, client gone before the first token) is not counted.
- **Older apps**: FaamOffice 0.11.1 and older treat every 429 as "busy" (their
  overload check matches `HTTP 429`) and show their localized "The AI service is
  busy right now — please try again in a moment" instead of the server message,
  so `daily_limit_reached` reaches those users without the reset time and they
  keep retrying. The status cannot change without breaking newer clients; when
  turning credits off with a daily limit, publish an in-app announcement with
  "Up to version" 0.11.1 asking them to install the latest release (0.11.1 has
  no update feed, so it must be reinstalled by hand). The admin Settings page
  says the same next to the switch.
- Not configured → 503 `{ "error": { "message": "Faam AI Cloud is not configured on this server", "type": "unavailable" } }`.
- Body limit 20 MB → 413 `payload_too_large`; invalid JSON → 400 `invalid_json`;
  missing `model`/`messages` → 400 `invalid_request`.
- Upstream failures: 400/404/409/413/422/429 bodies are passed through with their
  status; upstream 401/403 and 5xx/network errors become 502
  `{ "error": { "message": …, "type": "upstream_error" } }`.
- Billing: after completion, usage (`prompt_tokens`, `completion_tokens`) is priced
  per model and a UsageRecord, a ledger entry and the balance decrement are
  written in one transaction (the balance may go slightly negative on the last
  request). With credits off only the UsageRecord is written, with `credits: 0`
  (no ledger entry, balance untouched). The mode is read once per request, so a
  request in flight keeps the mode it started with. Without upstream usage,
  tokens are estimated as characters ÷ 4 (images count 765 tokens) and the
  record is flagged `estimated`.
- When the client disconnects, the upstream request is aborted and the partial
  output is billed by estimate.

### 4. Announcements (no auth)

Public, cookie-free and CORS-readable: every response, errors included, carries
`Access-Control-Allow-Origin: *` and `Access-Control-Expose-Headers: Retry-After`.
Drafts are never exposed. Rate limit: 300 requests per minute per IP (429
`rate_limited` with `Retry-After`).

`GET /api/v1/announcements?platform=mac|win|linux&version=0.11.1&locale=vi`

```json
{
  "announcements": [
    {
      "id": "cm…",
      "kind": "rich",
      "level": "info",
      "displayMode": "once",
      "title": "…",
      "body": "…",
      "imageUrl": "https://faamoffice.net/api/v1/announcements/cm…/image?v=cm…",
      "htmlUrl": "https://faamoffice.net/announcement-frame/cm…?locale=vi",
      "link": { "url": "https://…", "label": "…" },
      "startsAt": "2026-10-07T00:00:00.000Z",
      "endsAt": "2026-10-31T00:00:00.000Z",
      "updatedAt": "2026-10-07T00:00:00.000Z"
    }
  ]
}
```

- `kind`: `rich` | `html`; `level`: `info` | `warning` | `critical`;
  `displayMode`: `once` | `every_launch` | `until_dismissed` (the app keeps
  per-device "seen" / "dismissed" state keyed by `id`, and may use `updatedAt`
  to show an edited announcement again).
- Optional keys are **omitted** when empty: `body` (rich only), `imageUrl`
  (rich only: the uploaded image or an external https URL), `htmlUrl` (html
  only; load it in an `<iframe>`), `link` (label defaults to "Xem chi tiết" /
  "Learn more"), `endsAt`.
- Only `published` announcements with `startsAt ≤ now < endsAt` (or no
  `endsAt`), matching the platform (or targeting all platforms) and the version
  range (numeric `x.y.z` compare, inclusive; pre-release/build suffixes such as
  `-beta.1` or `+build.7` are ignored, also when the `+` is sent unencoded and
  arrives as a space). Sorted by `priority` desc, then `startsAt` desc; at most 5.
- `platform` also accepts Node's `darwin` / `win32`; when omitted, platforms are
  not filtered. A missing or unparsable `version` disables version filtering.
- `locale`: `vi` (also `vi-VN`, and the default) → Vietnamese fields; any other
  locale → English fields, each falling back to Vietnamese.
- `Cache-Control: public, max-age=60`. An unknown `platform` or a malformed
  `locale` → 400 `{ "error": "invalid_request", "message": …, "field": … }`.

`GET /api/v1/announcements/{id}?locale=vi` — one published (and started)
announcement, the same object as a list item (not wrapped); 404 `not_found` for
drafts and unknown ids.

`GET /api/v1/announcements/{id}/image` — the uploaded image bytes with the stored
`Content-Type` (png/jpeg/webp/gif), `Content-Length`, `Cache-Control: public,
max-age=86400` and `X-Content-Type-Options: nosniff`; 404 for drafts and missing
images. The `v` query parameter in `imageUrl` changes when the image is replaced.

`GET /announcement-frame/{id}?locale=vi` (outside `/vi`/`/en`, not in the
sitemap, disallowed in robots.txt) — a complete HTML document around the
announcement's HTML (`<base target="_blank">`, a small neutral stylesheet with
light/dark via `prefers-color-scheme`). Headers: `Content-Security-Policy:
sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src
https: data:; style-src 'unsafe-inline' https:; font-src https: data:; media-src
https:; base-uri 'none'; form-action 'none'; frame-ancestors *`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and **no**
`X-Frame-Options`. Drafts and `rich` announcements → 404.

### 5. App configuration (no auth)

`GET /api/v1/app/config` — public settings for the desktop app (fetched once
per session, without a token):

```json
{ "socials": [ { "id": "k3v9x2", "platform": "youtube", "url": "https://www.youtube.com/@faamoffice", "label": "Kênh chính" },
               { "id": "p0q7aa", "platform": "zalo", "url": "https://zalo.me/123456789" } ] }
```

- `socials`: the enabled social links in display order; `label` is omitted when
  empty. `platform` is one of `facebook`, `youtube`, `tiktok`, `zalo`, `x`,
  `instagram`, `threads`, `telegram`, `discord`, `github`, `linkedin`, `website`;
  every `url` is https on the platform's own hosts (see Settings above), but
  clients should still validate before opening.
- More keys may be added later: ignore unknown keys.
- 503 `{ "error": "unavailable", … }` (`Cache-Control: no-store`, `Retry-After`)
  when the stored settings cannot be read (database error, unreadable row): keep
  the cached list. Only a 200 is an authoritative list; an empty `socials` there
  means there really are no channels.
- Cookie-free and CORS-readable (`Access-Control-Allow-Origin: *`, errors
  included), `Cache-Control: public, max-age=300`; 300 requests per minute per IP
  (429 `rate_limited` with `Retry-After`).

### Web (cookie) endpoints

Used by the website; they require the session cookie (where relevant) and a
same-site `Origin` header (CSRF), and are rate limited per process:
`POST /api/auth/{register,login,logout,forgot-password,reset-password}`,
`POST /api/auth/device/approve` (`{ user_code, action: "approve" | "deny" }`),
`POST /api/account/{profile,password,delete,resend-verification,tokens/revoke}`,
`POST /api/admin/users/:id/{credits,status}`,
`PATCH /api/admin/settings` (any subset of `{ creditsEnabled, aiDailyRequestLimit,
socialLinks }`; `PUT` takes all three; both reply `{ ok: true, settings }` with the
stored values; invalid input → 400 `invalid_request` with `fields`, e.g.
`{ "socialLinks.2.url": "wrong_host" }`; codes `required`, `https_only`,
`wrong_host`, `too_long`, `too_many`, `duplicate`, `out_of_range`, `invalid`;
`creditsEnabled` must be a JSON boolean),
`POST /api/admin/announcements` (create), `POST /api/admin/announcements/:id`
(update; replies with the stored editor `values` and `image`),
`POST /api/admin/announcements/:id/{status,delete}` and
`POST /api/admin/announcements/images` (multipart `file`, ≤ 2 MB, else 413
`image_too_large`). Admin-only
reads: `GET /api/admin/announcements/images/:id` (editor preview, drafts included).

## Testing

```bash
npm test
```

Suites: scrypt hashing, user codes, the device-flow state machine, a SQLite
integration suite (device flow end to end, bearer auth, ledger), token hashing,
billing math and estimation, model mapping/request rewriting, the rate limiter,
the SSE usage parser, locale negotiation, dictionary parity, request guards,
release asset mapping, announcements (version/platform/locale matching,
input validation, image magic bytes and size cap, the frame's sandbox headers
and routing, CORS on public errors, a SQLite suite over the public and admin
route handlers, and the editor's server-rendered markup: accessibility and
error placement), site settings (schemas, social link hosts, defaults, cache and
fallbacks, the admin route's auth/Origin/validation, `/api/v1/app/config`, the
footer's follow links, `/api/v1/me` and `/api/v1/usage` in both credit modes) and
the AI proxy with credits on and off (402, 0-credit usage without ledger, the
UTC+7 daily limit with `Retry-After` and running requests counted, the per-user
burst limit).

Smoke test — start a server pointed at the mock upstream the script runs on port
4555, then run the script (it starts nothing else):

```bash
FAAM_AI_UPSTREAM_BASE_URL=http://127.0.0.1:4555/v1 FAAM_AI_UPSTREAM_API_KEY=mock-upstream-key \
ADMIN_EMAILS=smoke-admin@faamoffice.test npm run dev        # or npm run build && npm start
npm run smoke                                               # SMOKE_BASE_URL overrides SITE_URL
```

It registers a user, signs in, runs the device flow (approving with the web
session), calls `/api/v1/me`, streams and non-streams through the proxy and
verifies the upstream request, usage records, abort handling and — depending on
the server's Faam credits mode — credit deduction or free, quota-counted usage
(with credits off, the daily limit must allow at least 5 requests, or be 0).
Admin checks run when `smoke-admin@faamoffice.test` is in `ADMIN_EMAILS`: the
Settings page and API, credit adjustment and 402 with credits on, the 0-credit
path and 429 `daily_limit_reached` with credits off, a social link in
`/api/v1/app/config`, disable/enable; the original settings are restored at the end. Registration is limited to
10 per hour per IP, so restart the server if you run it many times.
`npx tsx scripts/mock-upstream.ts` runs the mock alone for manual testing.

## SEO checklist

- [x] `/vi/…` and `/en/…` routes; `/` (and any unprefixed path, e.g. `/device`) redirects by `fo_locale` cookie → `Accept-Language` → Vietnamese
- [x] Static generation for public pages, revalidated hourly and whenever an admin saves the site settings (footer follow links); the download page reads GitHub Releases hourly
- [x] Per-page title/description, canonical, `hreflang` vi/en/x-default, Open Graph + Twitter card
- [x] 1200×630 OG/Twitter images per locale (`next/og`, Inter with Vietnamese glyphs, built at build time)
- [x] `metadataBase` from `SITE_URL`; `sitemap.xml` with both locales and alternates; `robots.txt` disallowing `/api`, `/announcement-frame`, `/account`, `/admin`, `/device` (+ localized)
- [x] JSON-LD: SoftwareApplication, Organization, WebSite, FAQPage (home), BreadcrumbList (sub-pages)
- [x] `noindex` on auth, account, admin and device pages
- [x] `lang` per locale, one `h1` per page, landmarks, skip link, alt text / `aria-hidden` decorations, visible focus, AA contrast
- [x] Light/dark via `prefers-color-scheme`; responsive down to 320 px; JS-free mobile menu and FAQ (`<details>`)
- [x] Favicon (`.ico` + SVG), Apple touch icon, web manifest with 192/512 icons
- [x] Security headers: CSP, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `nosniff`, HSTS on https
  (except `/announcement-frame/*`, which has its own sandbox CSP and must be embeddable)

## Project layout

```
prisma/              schema, migrations, seed
scripts/             smoke test, mock upstream, make-admin
src/proxy.ts         locale redirects (Next 16 "proxy", formerly middleware)
src/app/[locale]/    pages (home, download, faam-ai, privacy, terms, auth, device, account, admin)
src/app/api/         route handlers (auth, device flow, account, admin, v1)
src/app/announcement-frame/  sandboxed HTML of announcements (outside the locale routing)
src/lib/             auth/session, device flow, tokens, billing, AI proxy and daily quota, mail, SEO, announcements, site settings
src/i18n/            locale config and vi/en dictionaries
tests/               vitest suites
```

The privacy policy and terms are templates with placeholders and a visible note:
the operator must review and complete them.

---

## Hướng dẫn nhanh (tiếng Việt)

```bash
cd web
cp .env.example .env          # chỉnh SITE_URL, SMTP_*, FAAM_AI_*, ADMIN_EMAILS
npm install
npx prisma migrate dev        # tạo cơ sở dữ liệu SQLite tại data/faamoffice.db
npm run dev                   # http://localhost:3000
```

- Chưa cấu hình SMTP thì email xác nhận / đặt lại mật khẩu được in ra console của máy chủ.
- Tạo quản trị viên: thêm email vào `ADMIN_EMAILS` hoặc chạy `npm run make-admin -- email@cua-ban.vn`.
- Bật Faam AI Cloud: điền `FAAM_AI_UPSTREAM_BASE_URL` (OpenAI, OpenRouter, hoặc Ollama
  `http://localhost:11434/v1`), `FAAM_AI_UPSTREAM_API_KEY` và bảng giá `FAAM_AI_MODELS`.
- Chạy bằng Docker: `docker compose up -d --build` (dữ liệu nằm trong volume `faam-data`).
- Kiểm tra: `npm run lint && npm run typecheck && npm test && npm run build`, sau đó `npm run smoke`
  với máy chủ đang chạy (xem mục Testing ở trên).
- Thông báo trong ứng dụng: vào `/vi/admin/announcements` (thẻ "Thông báo" trong trang quản trị) để
  tạo hộp thoại hiện khi FaamOffice khởi động — loại "Ảnh và văn bản" hoặc "Trang HTML" (chạy trong
  khung cách ly, không có script), chọn mức độ, cách hiển thị, nền tảng, khoảng phiên bản và thời gian,
  xem trước rồi xuất bản. Ứng dụng đọc `GET /api/v1/announcements` (xem mục "4. Announcements").
- Cài đặt chung: vào `/vi/admin/settings` (thẻ "Cài đặt"). Thẻ **Faam credit** bật/tắt việc tính
  credit: khi tắt, người dùng chỉ cần đăng nhập tài khoản để dùng các mô hình Faam AI Cloud trong ứng
  dụng (không trừ credit, không hiện credit), có thể giới hạn "Số lượt Faam AI mỗi người mỗi ngày"
  (0 = không giới hạn, tính theo giờ Việt Nam); bật lại bất cứ lúc nào, số dư được giữ nguyên.
  FaamOffice 0.11.1 trở về trước báo hết lượt thành “Dịch vụ AI hiện đang bận”, nên khi đặt giới hạn
  hãy đăng một thông báo ("Đến phiên bản" 0.11.1) nhắc người dùng cài bản mới. Thẻ
  **Kênh theo dõi** thêm/sửa/xóa/sắp xếp tối đa 12 nút theo dõi (Facebook, YouTube, TikTok, Zalo…),
  hiện ở chân trang web và trong ứng dụng (phía trên nút Cài đặt). Ứng dụng đọc `GET /api/v1/app/config`.
- Chính sách quyền riêng tư và điều khoản dịch vụ là văn bản mẫu: đơn vị vận hành cần xem lại
  và điền thông tin trước khi dùng.
