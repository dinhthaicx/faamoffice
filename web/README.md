# FaamOffice web

Website and account backend for [FaamOffice](../README.md): bilingual marketing site
(Vietnamese default, English), web accounts, desktop sign-in (device code flow),
credits and usage history, an admin dashboard, and **Faam AI Cloud** — an
OpenAI-compatible AI proxy that bills credits using the server's upstream key.

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
| `SIGNUP_BONUS_CREDITS` | `100` | Credits for new accounts (ledger reason `signup_bonus`) |
| `ADMIN_EMAILS` | – | Comma-separated emails promoted to ADMIN at registration/login |
| `COOKIE_SECURE` | `true` when `SITE_URL` is https | Secure session cookie (`__Host-fo_session`) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | – | Used by `npm run db:seed` |
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
payment gateway: admins add credits manually.

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
| `GET /api/v1/me` | `{ id, email, name, emailVerified, role, credits, createdAt }` |
| `POST /api/v1/logout` | 204, revokes the calling token |
| `GET /api/v1/usage?limit=20&cursor=<id>` | `{ items: [{ id, createdAt, model, promptTokens, completionTokens, credits }], nextCursor }` (newest first, `limit` 1–100, `nextCursor` null on the last page) |
| `GET /api/v1/ai/models` | `{ object: "list", data: [{ id, object: "model", owned_by: "faam" }] }` |
| `POST /api/v1/ai/chat/completions` | OpenAI-compatible proxy (below) |

### 3. `POST /api/v1/ai/chat/completions`

The app uses base URL `${SITE_URL}/api/v1/ai` and appends `/chat/completions`.

- Body forwarded unchanged except: `model` mapped to the upstream id,
  `stream_options: { include_usage: true }` added when `stream: true`, and
  `max_tokens` / `max_completion_tokens` capped by `maxOutputTokens`. `tools`,
  `tool_choice`, tool-call deltas and images (data URLs) pass through untouched.
- `stream: true` → SSE passthrough, chunks piped as they arrive (the final usage
  chunk with `choices: []` is passed through as well); otherwise the upstream JSON.
- Unknown model → 400 `{ "error": "model_not_found", "message": … }`.
- Credits ≤ 0 → 402 `{ "error": { "message": "Your Faam AI credits are insufficient. Ask an administrator to add credits.", "type": "insufficient_credits", "code": "insufficient_credits" } }`.
- Not configured → 503 `{ "error": { "message": "Faam AI Cloud is not configured on this server", "type": "unavailable" } }`.
- Body limit 20 MB → 413 `payload_too_large`; invalid JSON → 400 `invalid_json`;
  missing `model`/`messages` → 400 `invalid_request`.
- Upstream failures: 400/404/409/413/422/429 bodies are passed through with their
  status; upstream 401/403 and 5xx/network errors become 502
  `{ "error": { "message": …, "type": "upstream_error" } }`.
- Billing: after completion, usage (`prompt_tokens`, `completion_tokens`) is priced
  per model and a UsageRecord, a ledger entry and the balance decrement are
  written in one transaction (the balance may go slightly negative on the last
  request). Without upstream usage, tokens are estimated as characters ÷ 4
  (images count 765 tokens) and the record is flagged `estimated`.
- When the client disconnects, the upstream request is aborted and the partial
  output is billed by estimate.

### Web (cookie) endpoints

Used by the website; they require the session cookie (where relevant) and a
same-site `Origin` header (CSRF), and are rate limited per process:
`POST /api/auth/{register,login,logout,forgot-password,reset-password}`,
`POST /api/auth/device/approve` (`{ user_code, action: "approve" | "deny" }`),
`POST /api/account/{profile,password,delete,resend-verification,tokens/revoke}`,
`POST /api/admin/users/:id/{credits,status}`.

## Testing

```bash
npm test
```

70 tests: scrypt hashing, user codes, the device-flow state machine, a SQLite
integration suite (device flow end to end, bearer auth, ledger), token hashing,
billing math and estimation, model mapping/request rewriting, the rate limiter,
the SSE usage parser, locale negotiation, dictionary parity, request guards and
release asset mapping.

Smoke test — start a server pointed at the mock upstream the script runs on port
4555, then run the script (it starts nothing else):

```bash
FAAM_AI_UPSTREAM_BASE_URL=http://127.0.0.1:4555/v1 FAAM_AI_UPSTREAM_API_KEY=mock-upstream-key \
ADMIN_EMAILS=smoke-admin@faamoffice.test npm run dev        # or npm run build && npm start
npm run smoke                                               # SMOKE_BASE_URL overrides SITE_URL
```

It registers a user, signs in, runs the device flow (approving with the web
session), calls `/api/v1/me`, streams and non-streams through the proxy and
verifies the upstream request, credit deduction, usage records and abort
handling. Admin checks (402, credit adjustment, disable/enable) run when
`smoke-admin@faamoffice.test` is in `ADMIN_EMAILS`. Registration is limited to
10 per hour per IP, so restart the server if you run it many times.
`npx tsx scripts/mock-upstream.ts` runs the mock alone for manual testing.

## SEO checklist

- [x] `/vi/…` and `/en/…` routes; `/` (and any unprefixed path, e.g. `/device`) redirects by `fo_locale` cookie → `Accept-Language` → Vietnamese
- [x] Static generation for public pages (download page revalidates hourly from GitHub Releases)
- [x] Per-page title/description, canonical, `hreflang` vi/en/x-default, Open Graph + Twitter card
- [x] 1200×630 OG/Twitter images per locale (`next/og`, Inter with Vietnamese glyphs, built at build time)
- [x] `metadataBase` from `SITE_URL`; `sitemap.xml` with both locales and alternates; `robots.txt` disallowing `/api`, `/account`, `/admin`, `/device` (+ localized)
- [x] JSON-LD: SoftwareApplication, Organization, WebSite, FAQPage (home), BreadcrumbList (sub-pages)
- [x] `noindex` on auth, account, admin and device pages
- [x] `lang` per locale, one `h1` per page, landmarks, skip link, alt text / `aria-hidden` decorations, visible focus, AA contrast
- [x] Light/dark via `prefers-color-scheme`; responsive down to 320 px; JS-free mobile menu and FAQ (`<details>`)
- [x] Favicon (`.ico` + SVG), Apple touch icon, web manifest with 192/512 icons
- [x] Security headers: CSP, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `nosniff`, HSTS on https

## Project layout

```
prisma/              schema, migrations, seed
scripts/             smoke test, mock upstream, make-admin
src/proxy.ts         locale redirects (Next 16 "proxy", formerly middleware)
src/app/[locale]/    pages (home, download, faam-ai, privacy, terms, auth, device, account, admin)
src/app/api/         route handlers (auth, device flow, account, admin, v1)
src/lib/             auth/session, device flow, tokens, billing, AI proxy, mail, SEO
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
- Chính sách quyền riêng tư và điều khoản dịch vụ là văn bản mẫu: đơn vị vận hành cần xem lại
  và điền thông tin trước khi dùng.
