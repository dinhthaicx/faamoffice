# FaamOffice Privacy

Last updated: October 7, 2026

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

### Turning the checks off

- `FAAMOFFICE_ANNOUNCEMENTS=0` (environment variable at app start) turns off the
  announcement check and the channel list request. Buttons already received
  still show.
- `FAAMOFFICE_UPDATES=0` turns off the update check. Help → Check for Updates
  then points to the download page instead.

## Other network access

- The About page and the GitHub prompt read the public star count of the
  FaamOffice repository from api.github.com.
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

## Contact

Questions or concerns: open an issue at
https://github.com/dinhthaicx/faamoffice/issues.
