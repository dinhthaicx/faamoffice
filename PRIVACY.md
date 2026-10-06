# FaamOffice Privacy

Last updated: October 6, 2026

FaamOffice opens, edits and saves documents on your computer. Editing a
document never uploads it anywhere. The app only talks to the network for the
features listed below, and only when you use them.

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

FaamOffice works without an account. If you sign in to a FaamOffice account to
use Faam AI Cloud, the account server stores your email, name, a hash of your
password, the devices you signed in from, and a usage record (time, model,
token counts, credits) for each cloud AI request. The requests themselves are
forwarded to the AI provider the server operator configured. See the privacy
policy published on that server's website.

## Other network access

- The About page and the GitHub prompt read the public star count of the
  FaamOffice repository from api.github.com.
- Links you click (downloads, API-key pages, GitHub) open in your browser.
- Builds from this repository send no usage analytics, check no update feed and
  download no fonts unless whoever built them injected the corresponding
  endpoints (`GENOFFICE_GA4_*`, `GENOFFICE_UPDATE_URL`, `GENOFFICE_FONT_CDN_URL`
  in `apps/shell/electron-builder.cjs`). The release workflow in this repository
  injects none of them.

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

## Contact

Questions or concerns: open an issue at
https://github.com/dinhthaicx/faamoffice/issues.
