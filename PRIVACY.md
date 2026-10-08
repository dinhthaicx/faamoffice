# FaamOffice Privacy

Last updated: October 8, 2026

FaamOffice opens, edits and saves documents on your computer. Editing a
document never uploads it anywhere. The app only talks to the network for the
features listed below. Apart from the startup checks (announcements, the list of
channels to follow and, in release builds, the update check), it does so only
when you use them.

## AI (Faam AI)

- **Your own API key** (OpenAI, Anthropic, Google Gemini, DeepSeek, Groq and
  others): the text, document excerpts and images that a Faam AI request needs
  are sent directly from your computer to the provider you chose, under that
  provider's privacy policy. The key is stored only on this computer.
- **Local AI** (Ollama, LM Studio, llama.cpp or another server you run): requests
  go to the address you entered; with a server on your own machine nothing
  leaves it.
- **Web and image search** used by Faam AI go to the search provider selected
  under Settings → AI Media, or to the free sources (Parallel, DuckDuckGo).

## FaamOffice account (optional)

FaamOffice works without an account. Signing in to a FaamOffice account only
gives the app access to the Faam AI Cloud models. The account server stores
your email, name, a hash of your password, the devices you signed in from, and
a usage record (time, model, token counts and, when the server operator charges
credits, the credits used) for each cloud AI request. The operator may limit
how many requests each account can make per day. The requests themselves are
forwarded to the AI provider the server operator configured. See the privacy
policy published on that server's website.

For **faamoffice.net**, the operator is **dinhthaicx**, in Vietnam, with public
contact **dinhthaicx@gmail.com**. Faam AI Cloud requests (prompts, conversation
history, document content and images included in the request) leave your
computer and pass through the FaamOffice server. The current inference backend
is **Ollama running Qwen 3.5 on that same server computer**, reached over a
loopback address. This configuration does not forward requests to an external
cloud AI API. Local inference on the server does not mean that Cloud requests
stay on your own computer. The account backend stores usage metadata, not
request or reply content, in its usage-history database. Its error logs exclude
upstream response bodies, which could echo document content. Read the website
policy in [Vietnamese](https://faamoffice.net/vi/privacy) or
[English](https://faamoffice.net/en/privacy), and Ollama's local-processing
explanation at https://docs.ollama.com/faq.

Account verification and password recovery email can be sent through **Brevo**.
For these messages, the server provides Brevo with the recipient email address,
the name in the greeting and the message containing a short-lived verification
or reset link. This does not send document content, AI requests or the original
password to Brevo. Brevo may retain delivery logs and record opens or link clicks
depending on its configuration; see https://www.brevo.com/legal/privacypolicy/.
Production email error logs on the FaamOffice server exclude credentials,
recipient addresses and links containing tokens. Stored SMTP keys are encrypted
on the server and are never returned to the Superadmin page after saving.

## Startup checks

### Announcements

Once per app start, the app asks the FaamOffice account server
(https://faamoffice.net, or the account server set under Settings → Profile) for
announcements. The request carries your operating system (mac, win or linux),
the app version and the interface language, and no account token or other
identifier. Images in an announcement are downloaded from the address its
author used, and an HTML announcement may load images and fonts from other
https sites, so those servers see your IP address. Which announcements you have
seen or dismissed is stored only on this computer.

### Channels to follow

Once per app start, together with the announcement check (on the very first
start, once the welcome screens are done), the app also reads the list of the
project's channels (Facebook, YouTube, TikTok and others) shown as follow
buttons above Settings on the Home screen, from the same account server
(`/api/v1/app/config`). The request carries no account token, no identifier and
no other parameters. The last list received is kept on this computer so the
buttons show offline. A channel opens in your browser only when you click its
button.

### Update check

Builds published from a version tag in this repository check GitHub Releases
for a newer version, about 15 seconds after start and then every few hours
(https://github.com/dinhthaicx/faamoffice/releases/latest/download/, which
GitHub serves from its own download servers). Each check downloads a small
`latest*.yml` file. The request carries the random install ID that the updater
library generates (the `x-user-staging-id` header, stored as `.updaterId` in the
app's data folder) and no account or document information; GitHub sees your IP
address. Downloading an update fetches the installer from the same release.
Builds without an update address (development runs, manual workflow runs, local
packaging, 0.11.1 and older) make no update request.
Microsoft Store packages have no app-managed update feed; the Store manages
their updates.

### Turning the checks off

- `FAAMOFFICE_ANNOUNCEMENTS=0` (environment variable at app start) turns off the
  announcement check and the channel list request. Buttons already received
  still show.
- `FAAMOFFICE_UPDATES=0` turns off the update check. Help → Check for Updates
  then points to the download page instead.

These are runtime environment controls. The current installer does not yet
display this policy or offer installation options for these automatic
connections. Adding those controls and rebuilding the app/installer is still
required preparation for SignPath; this document does not claim that the
installer already meets SignPath's requirements.

## Other network access

- Opening Settings (including About) can read the public
  star count of the FaamOffice repository from api.github.com, cached for the
  session. This request sends no account or document information; GitHub sees
  your IP. See https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement.
- The faamoffice.net website and API use Cloudflare Tunnel. Cloudflare handles
  traffic and connection information to provide and protect the service, under
  https://www.cloudflare.com/privacypolicy/.
- Links you click (downloads, API-key pages, GitHub) open in your browser.
- Builds from this repository send no usage analytics and download no fonts
  unless whoever built them injected the corresponding endpoints
  (`GENOFFICE_GA4_*`, `GENOFFICE_FONT_CDN_URL` in
  `apps/shell/electron-builder.cjs`); the release workflow in this repository
  injects neither. It injects only the update address (`GENOFFICE_UPDATE_URL`,
  the GitHub Releases feed above), and only into builds made from a version
  tag.

## Usage analytics (only when enabled at build time)

Builds from this repository contain a no-op tracker and send nothing. A
distributor can enable anonymous usage analytics by injecting Google Analytics 4
credentials at build time (`GENOFFICE_GA4_MEASUREMENT_ID` /
`GENOFFICE_GA4_API_SECRET`). In such a build, onboarding explains it and you can
turn it off under **Settings → General → Send anonymous usage statistics**.

When enabled, the app sends these events:

- `install_first_launch` — marks the first analytics-enabled use of a newly
  assigned anonymous `client_id`; used for retention cohorts
- `app_launch` — no event-specific parameter
- `file_open` — `ext`, the file extension such as `docx` or `xlsx`
- `file_new` — `kind`, one of `docx`, `xlsx`, `pptx`, `md`, or `pdf`

Every event includes `app_version`, `platform`, `os_version`, `ui_lang`, a
per-process `session_id`, `engagement_time_msec` (fixed `100`) and, when the
operating system's regional locale provides one, the two-letter `country_id`.
The `client_id` is a random install UUID. Analytics never sends document
content, file names, file paths, account identity or email addresses.

## Website installer-download statistics

Clicking an installer link on faamoffice.net sends the selected package, release
version, website language and button location to the website's statistics
endpoint. It stores aggregate counts by Vietnam calendar day (GMT+7), without
IP addresses, user agents, cookies, account details or visitor identifiers.
The IP is used only in a short-lived in-memory rate limiter. No tracking cookie
is added. Statistics are restricted to administrators and do not confirm a
completed download or installation. They begin when this feature is deployed;
downloads from other sites or links shared outside the website are not counted.

Installer links go straight to the GitHub release files even if tracking fails
or JavaScript is disabled. GitHub processes those requests under its own policy.
GitHub's separate public asset download counts may also be shown in the admin
dashboard; they include sources outside faamoffice.net and are not combined
with website click counts. Anonymous daily aggregate counts have no automatic
deletion period.

## Contact

Operator: **dinhthaicx**, Vietnam. Privacy contact: **dinhthaicx@gmail.com**.
Questions or concerns can also be reported at
https://github.com/dinhthaicx/faamoffice/issues. Do not include private document
content, passwords or API keys in a public issue.
