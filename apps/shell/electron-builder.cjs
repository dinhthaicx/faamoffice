/**
 * electron-builder configuration (moved out of package.json "build" so the
 * auto-update feed URL can be injected at build time instead of living in
 * the repo).
 *
 * GENOFFICE_UPDATE_URL — public base URL of the update feed (the generic
 * provider prefix that serves latest.yml / latest-mac.yml /
 * latest-linux.yml). .github/workflows/release.yml sets it for v* tag builds
 * only, to https://github.com/<repo>/releases/latest/download (see
 * src/main/updater.ts); it must be HTTPS, or plain http on a loopback host
 * for local update tests. For local release builds it can also go in
 * apps/shell/electron-builder.env (gitignored) — the electron-builder CLI
 * loads that file automatically.
 *
 * When the variable is unset (forks, manual workflow runs, plain local
 * packaging) the publish config is omitted: electron-builder then bakes no
 * app-update.yml into the app and the app never checks for updates. The
 * dist:* scripts pass --publish never, and no GH_TOKEN / GITHUB_TOKEN may be
 * in the build environment: with either set and no publish config,
 * electron-builder would infer a GitHub provider on its own. For the same
 * reason package.json must not gain a "repository" field.
 *
 * GENOFFICE_GA4_MEASUREMENT_ID / GENOFFICE_GA4_API_SECRET — GA4 Measurement
 * Protocol credentials for anonymous usage analytics, injected the same way
 * (CI secrets, or apps/shell/electron-builder.env locally). They are written
 * into the packaged app's package.json via extraMetadata and read back by
 * src/main/analytics.ts. When either is unset — every source/fork build —
 * nothing is injected and the app runs with analytics fully disabled.
 *
 * GENOFFICE_FONT_CDN_URL — base URL for the curated downloadable-font catalog.
 * Official release jobs inject it through extraMetadata so the endpoint stays
 * out of source. Without it, font download prompts/catalog entries are hidden;
 * users can still install local font files.
 *
 * GENOFFICE_APPX=1 — the Microsoft Store package instead of the NSIS installer
 * (`npm run dist:win:store`, a separate electron-builder pass; release.yml runs
 * it after the NSIS one). It carries the identity reserved in Partner Center,
 * is left unsigned (the Store signs the package it distributes), bakes no
 * update feed even when GENOFFICE_UPDATE_URL is set (the Store updates it) and
 * marks the app with extraMetadata.faamofficeStore, which the Store-mode code
 * paths read (src/main/ms-store.ts).
 */

const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')

function normalizeHttpsBaseUrl(name, value) {
  if (!value || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('invalid')
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    throw new Error(`${name} must be an HTTPS base URL without credentials, query, or fragment`)
  }
}

/** the update feed base: HTTPS, or http on a loopback host (local tests) */
function normalizeUpdateFeedUrl(value) {
  if (!value || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    const trusted = url.protocol === 'https:' || (url.protocol === 'http:' && loopback)
    if (!trusted || url.username || url.password || url.search || url.hash) {
      throw new Error('invalid')
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    throw new Error(
      'GENOFFICE_UPDATE_URL must be an HTTPS base URL (http only on a loopback host) without credentials, query, or fragment',
    )
  }
}

const updateUrl = normalizeUpdateFeedUrl(process.env.GENOFFICE_UPDATE_URL)
const ga4MeasurementId = process.env.GENOFFICE_GA4_MEASUREMENT_ID
const ga4ApiSecret = process.env.GENOFFICE_GA4_API_SECRET
const fontCdnUrl = normalizeHttpsBaseUrl(
  'GENOFFICE_FONT_CDN_URL',
  process.env.GENOFFICE_FONT_CDN_URL,
)

// GENOFFICE_MAC_X64=1 — opt into packaging the Intel (x64) dmg/zip alongside
// arm64. Off by default: Intel packages must only ever ship signed with the
// company certificate (planned dual-track pipeline), so the current release
// pipeline stays arm64-only and never produces a personally-signed Intel
// artifact. The downstream layout (feed archive name, FaamOffice-intel.dmg
// alias) keys off which dmgs exist, so flipping this flag is the single
// switch.
const includeMacX64 = process.env.GENOFFICE_MAC_X64 === '1'

// GENOFFICE_WIN_ARM64=1 — package the Windows ARM64 installer instead of x64.
// CI runs it as a second electron-builder pass (own BUILD_DIR) after the
// unchanged x64 pass, so the two never share an output dir or a sidecar path:
// the sidecar comes from the matching cargo target dir and is checked to
// exist at beforePack because electron-builder exits 0 on a missing
// extraResources source (Sheets would ship dead on every ARM install).
const winArm64 = process.env.GENOFFICE_WIN_ARM64 === '1'
// 7-Zip packs ARM64 executables with its ARM64 branch filter, which the NSIS
// install-time extractor (Nsis7z) cannot decode: it silently skips
// FaamOffice.exe and every dll (electron-builder#9983). BCJ it can decode.
if (winArm64 && !process.env.ELECTRON_BUILDER_7Z_FILTER) {
  process.env.ELECTRON_BUILDER_7Z_FILTER = 'BCJ'
}
const winArch = winArm64 ? 'arm64' : 'x64'

// GENOFFICE_APPX=1 — the Microsoft Store package (see the header). x64 only:
// the Store listing has no ARM64 package yet.
const appxMode = process.env.GENOFFICE_APPX === '1'
if (appxMode && winArm64) {
  throw new Error('GENOFFICE_APPX=1 packages the x64 Store appx only; unset GENOFFICE_WIN_ARM64')
}
// Identity reserved for FaamOffice in Partner Center (Product identity page).
// The Package Family Name is the identity name plus the hash Windows derives
// from the publisher; the AUMID (PackageFamilyName!ApplicationId) is what
// Settings → Default apps deep-links to.
const STORE_IDENTITY_NAME = 'FaamOffice.FaamOffice'
const STORE_PUBLISHER = 'CN=7AA455FF-2513-4C36-8C88-729BB45AC901'
const STORE_PUBLISHER_DISPLAY_NAME = 'FaamOffice'
const STORE_APPLICATION_ID = 'FaamOffice'
const STORE_PACKAGE_FAMILY_NAME = 'FaamOffice.FaamOffice_hangrx54z3vxj'
const STORE_PRODUCT_ID = '9P0RJ9J87ZNQ'
const winSidecarTarget = winArm64 ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-gnu'
const WIN_SIDECAR = `../sheets/native/xlsx-engine/target/${winSidecarTarget}/release/xlsx-sidecar.exe`

function assertExtraResourceSources() {
  for (const rel of [
    '../../node_modules/electron/dist/LICENSES.chromium.html',
    '../../node_modules/@embedpdf/pdfium/dist/pdfium.wasm',
    '../pdf/node_modules/harfbuzzjs/hb-subset.wasm',
  ]) {
    if (!existsSync(join(__dirname, rel))) {
      throw new Error(
        `electron-builder extraResources source missing: ${rel} (npm hoisting changed?)`,
      )
    }
  }
}

// macOS local-OCR helper (scanned-page text recovery): a swiftc output, not
// an npm artifact — compiled here on demand so CI runners and fresh checkouts
// need no manual step. Universal (arm64 + x86_64) when both targets compile,
// host-arch otherwise; mac installers must not silently ship without it.
const VISION_OCR_HELPER = '../../packages/pdf2docx/ocr-helper/vision-ocr'

// Compile the helper. universalOnly=true has NO host-arch fallback: dual-arch
// packaging must fail loudly rather than ship a host-arch binary to both dmgs.
function compileVisionOcr({ universalOnly } = { universalOnly: false }) {
  const src = join(__dirname, `${VISION_OCR_HELPER}.swift`)
  const out = join(__dirname, VISION_OCR_HELPER)
  try {
    try {
      const slices = ['arm64', 'x86_64'].map((arch) => {
        const slice = `${out}.${arch}`
        execFileSync('swiftc', ['-O', src, '-target', `${arch}-apple-macos12`, '-o', slice], {
          stdio: 'inherit',
        })
        return slice
      })
      execFileSync('lipo', ['-create', ...slices, '-output', out], { stdio: 'inherit' })
      for (const slice of slices) rmSync(slice, { force: true })
    } catch (err) {
      if (universalOnly) throw err
      // cross-target SDK unavailable — a host-arch helper still serves this build
      execFileSync('swiftc', ['-O', src, '-o', out], { stdio: 'inherit' })
    }
  } catch (err) {
    throw new Error(`vision-ocr helper compile failed: ${err}`, { cause: err })
  }
}

const WIN_OCR_HELPER = '../../packages/pdf2docx/ocr-helper/win-ocr.exe'

function ensurePlatformHelpers() {
  if (process.platform === 'darwin' && !existsSync(join(__dirname, VISION_OCR_HELPER))) {
    compileVisionOcr()
  }
  if (process.platform === 'win32' && !existsSync(join(__dirname, WIN_OCR_HELPER))) {
    try {
      execFileSync(
        process.execPath,
        [join(__dirname, '../../packages/pdf2docx/ocr-helper/build-win.mjs')],
        { stdio: 'inherit' },
      )
    } catch (err) {
      throw new Error(`win-ocr helper compile failed: ${err}`, { cause: err })
    }
  }
}

// Dual-arch packs share one extraResources path, so the shipped helper must be
// a lipo fat binary. A stale host-arch build (dev path above) is rebuilt in
// place; if a universal build cannot be produced, packaging aborts — otherwise
// the other arch's OCR silently fails and every scanned page ships as bitmap.
function assertUniversalVisionOcr() {
  const helper = join(__dirname, VISION_OCR_HELPER)
  const wanted = ['x86_64', 'arm64']
  const archsOf = () =>
    existsSync(helper)
      ? execFileSync('lipo', ['-archs', helper], { encoding: 'utf8' }).trim().split(/\s+/)
      : []
  if (!wanted.every((w) => archsOf().includes(w))) {
    rmSync(helper, { force: true })
    compileVisionOcr({ universalOnly: true })
  }
  const archs = archsOf()
  for (const want of wanted) {
    if (!archs.includes(want)) {
      throw new Error(
        `vision-ocr helper is [${archs.join(', ')}] but both mac arch packages ship it`,
      )
    }
  }
}

// The module trees are electron-vite outputs produced by build:all; a missing
// one means that module's build did not run or failed. electron-builder only
// logs "file source doesn't exist" for an absent extraResources source and
// still exits 0, so without this the installer launches normally and is simply
// missing that editor — it surfaces only when a user opens the tab.
//
// Runs from the beforePack hook, not at module load: gen-third-party-notices
// requires this config to read extraResources, and the dist:* scripts run
// notices before build:all, when the out dirs legitimately don't exist yet.
// When the mac build packages BOTH arches (GENOFFICE_MAC_X64=1) its
// extraResources entry is a single path shared by the two packs, so the
// sidecar there must be a lipo fat binary — a host-arch-only build (the plain
// `native:build` dev path) would silently ship an arm64 sidecar inside the
// Intel dmg, where every workbook open fails. Runs from beforePack, dual-arch
// mac packs only.
function assertUniversalSidecar() {
  const sidecar = join(__dirname, '../sheets/native/xlsx-engine/target/release/xlsx-sidecar')
  if (!existsSync(sidecar)) {
    throw new Error(
      `mac extraResources source missing: ${sidecar} (run "npm run native:build:universal -w @genoffice/sheets" first)`,
    )
  }
  const archs = execFileSync('lipo', ['-archs', sidecar], { encoding: 'utf8' }).trim().split(/\s+/)
  for (const want of ['x86_64', 'arm64']) {
    if (!archs.includes(want)) {
      throw new Error(
        `xlsx-sidecar is [${archs.join(', ')}] but both mac arch packages ship it — ` +
          'run "npm run native:build:universal -w @genoffice/sheets" before packaging mac',
      )
    }
  }
}

function assertModuleTreesPresent() {
  for (const rel of [
    '../docs/out',
    '../sheets/out',
    '../slides/out',
    '../pdf/out',
    '../markdown/out',
    '../html/out',
    '../../packages/cli/dist/faamoffice.cjs',
    '../../packages/cli/dist/node_modules/jsdom',
  ]) {
    if (!existsSync(join(__dirname, rel))) {
      throw new Error(
        `electron-builder extraResources source missing: ${rel} (run npm run build:all first)`,
      )
    }
  }
}

const CLI_BUNDLE_REL = '../../packages/cli/dist/faamoffice.cjs'
const CLI_BUILD_REL = '../../packages/cli/build.mjs'
const CLI_VERSION_ENV = 'GENOFFICE_APP_VERSION'
const CLI_VERSION_BANNER = /^const __cliAppVersion = ("(?:[^"\\]|\\.)*");$/m

/**
 * The version the packaged app reports: CI's -c.extraMetadata.version deep-merges
 * into the block below, and without it electron-builder ships apps/shell/package.json.
 */
function packagedAppVersion() {
  const injected = config.extraMetadata && config.extraMetadata.version
  if (typeof injected === 'string' && injected.trim()) return injected.trim()
  return require('./package.json').version
}

function bundledCliVersion(bundlePath) {
  const baked = CLI_VERSION_BANNER.exec(readFileSync(bundlePath, 'utf-8'))
  if (!baked) return null
  try {
    return JSON.parse(baked[1])
  } catch {
    return null
  }
}

/**
 * `faamoffice --version` is baked into the CLI bundle, which is built before
 * electron-builder runs and therefore before a release version is known. Rebuild
 * it here with the app version whenever the two disagree, so the packaged
 * command line can never answer with the workspace CLI version.
 */
function ensureCliBundleCarriesAppVersion() {
  const bundlePath = join(__dirname, CLI_BUNDLE_REL)
  const appVersion = packagedAppVersion()
  if (bundledCliVersion(bundlePath) === appVersion) return
  execFileSync(process.execPath, [join(__dirname, CLI_BUILD_REL)], {
    stdio: 'inherit',
    env: { ...process.env, [CLI_VERSION_ENV]: appVersion },
  })
  const baked = bundledCliVersion(bundlePath)
  if (baked !== appVersion) {
    throw new Error(
      `packaged faamoffice CLI reports ${baked ?? 'no version'} but the app ships ${appVersion} ` +
        `(rebuild it with ${CLI_VERSION_ENV}=${appVersion})`,
    )
  }
}

const NOTICE_PATH = join(__dirname, 'build/THIRD-PARTY-NOTICES.txt')
const PDFIUM_NOTICE_TERMS = ['@embedpdf/pdfium', 'Copyright 2014 PDFium Authors', 'Apache License']

function hasValidThirdPartyNotice() {
  if (!existsSync(NOTICE_PATH)) return false
  try {
    const text = readFileSync(NOTICE_PATH, 'utf8')
    return PDFIUM_NOTICE_TERMS.every((term) => text.includes(term))
  } catch {
    return false
  }
}

function ensureThirdPartyNotices() {
  if (!hasValidThirdPartyNotice()) {
    execFileSync(process.execPath, [join(__dirname, '../../tools/gen-third-party-notices.mjs')], {
      stdio: 'inherit',
    })
  }
  if (!hasValidThirdPartyNotice()) {
    throw new Error('third-party notice missing PDFium redistribution terms')
  }
}

/** @type {import('electron-builder').Configuration} */
const config = {
  appId: 'com.faamoffice.app',
  productName: 'FaamOffice',
  // Resolved from the installed electron package so dependency bumps can
  // never leave a stale hard-coded pin behind (packaging would silently ship
  // the old runtime).
  electronVersion: require('electron/package.json').version,
  directories: {
    output: process.env.BUILD_DIR || 'release',
  },
  files: ['out/**'],
  extraResources: [
    {
      from: 'build/THIRD-PARTY-NOTICES.txt',
      to: 'THIRD-PARTY-NOTICES.txt',
    },
    {
      from: '../../node_modules/electron/dist/LICENSES.chromium.html',
      to: 'LICENSES.chromium.html',
    },
    {
      from: '../docs/out',
      to: 'modules/docs',
    },
    {
      from: '../sheets/out',
      to: 'modules/sheets',
    },
    {
      from: '../slides/out',
      to: 'modules/slides',
    },
    {
      from: '../pdf/out',
      to: 'modules/pdf',
    },
    {
      from: '../markdown/out',
      to: 'modules/markdown',
    },
    {
      from: '../html/out',
      to: 'modules/html',
    },
    // PDF text editing engines: the bundled main resolves these under
    // Resources/wasm when node_modules is absent (apps/pdf/src/main/wasm-path.ts)
    {
      from: '../../node_modules/@embedpdf/pdfium/dist/pdfium.wasm',
      to: 'wasm/pdfium.wasm',
    },
    {
      from: '../pdf/node_modules/harfbuzzjs/hb-subset.wasm',
      to: 'wasm/hb-subset.wasm',
    },
    // platform system-OCR helpers for scanned-page recovery (each exists only
    // on its own build platform; electron-builder skips absent sources and the
    // engine resolver degrades to the bitmap fallback when missing)
    {
      from: '../../packages/pdf2docx/ocr-helper/vision-ocr',
      to: 'ocr/vision-ocr',
    },
    {
      from: '../../packages/pdf2docx/ocr-helper/win-ocr.exe',
      to: 'ocr/win-ocr.exe',
    },
    // faamoffice command line: runs on the app binary with ELECTRON_RUN_AS_NODE,
    // so the RunAsNode fuse must stay enabled.
    // Layout (Resources/cli next to wasm/, native/, ocr/) is what
    // packages/cli/src/resources.ts expects.
    {
      from: '../../packages/cli/dist/faamoffice.cjs',
      to: 'cli/faamoffice.cjs',
    },
    {
      from: '../../packages/cli/bin/faamoffice',
      to: 'cli/faamoffice',
    },
    {
      from: '../../packages/cli/bin/faamoffice.cmd',
      to: 'cli/faamoffice.cmd',
    },
    // the CLI's version (Settings → Integrations shows it) and the agent skill
    // the same pane installs into Claude Code / Codex / …; bytes identical to the repo file
    {
      from: '../../packages/cli/package.json',
      to: 'cli/package.json',
    },
    {
      from: '../../skills/faamoffice/SKILL.md',
      to: 'cli/skills/faamoffice/SKILL.md',
    },
    // runtime deps the faamoffice bundle leaves external (jsdom for the Word/Markdown
    // paths); collected by packages/cli/collect-deps.mjs during its build
    {
      from: '../../packages/cli/dist/node_modules',
      to: 'cli/node_modules',
    },
  ],
  // `mimeType` is read only by the Linux target, where it becomes the
  // desktop entry's MimeType= list; associations without it are dropped
  // there. macOS and Windows ignore the field and key off `ext`.
  //
  // `icon` is extension-less on purpose: electron-builder resolves it against
  // build/ as <icon>.icns for the mac CFBundleDocumentTypes entry and
  // <icon>.ico for the NSIS DefaultIcon registry value. Without it both
  // platforms fall back to the app icon, so every associated file shows the
  // bare FaamOffice logo instead of a per-type document icon. The icns/ico
  // pairs are generated from the shell renderer's file-type tiles by
  // tools/gen-file-association-icons.mjs.
  fileAssociations: [
    {
      ext: 'docx',
      name: 'Word Document',
      description: 'Word Document',
      role: 'Editor',
      icon: 'docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    {
      ext: 'doc',
      name: 'Word 97-2003 Document',
      description: 'Word 97-2003 Document',
      role: 'Editor',
      icon: 'docx',
      mimeType: 'application/msword',
    },
    {
      ext: 'xlsx',
      name: 'Excel Workbook',
      description: 'Excel Workbook',
      role: 'Editor',
      icon: 'xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    {
      ext: 'xlsm',
      name: 'Excel Macro-Enabled Workbook',
      role: 'Editor',
      icon: 'xlsx',
      mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    },
    {
      ext: 'pptx',
      name: 'PowerPoint Presentation',
      description: 'PowerPoint Presentation',
      role: 'Editor',
      icon: 'pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    },
    {
      ext: 'xls',
      name: 'Excel 97-2003 Workbook',
      role: 'Editor',
      icon: 'xlsx',
      mimeType: 'application/vnd.ms-excel',
    },
    {
      ext: 'csv',
      name: 'CSV Document',
      role: 'Editor',
      icon: 'xlsx',
      mimeType: 'text/csv',
    },
    {
      // opens as a converted copy and saves as .xlsx (genoffice#1146)
      ext: 'tsv',
      name: 'TSV Document',
      role: 'Editor',
      icon: 'xlsx',
      mimeType: 'text/tab-separated-values',
    },
    {
      ext: 'pdf',
      name: 'PDF Document',
      role: 'Editor',
      icon: 'pdf',
      mimeType: 'application/pdf',
    },
    {
      ext: 'md',
      name: 'Markdown Document',
      role: 'Editor',
      icon: 'md',
      mimeType: 'text/markdown',
    },
    {
      ext: 'markdown',
      name: 'Markdown Document',
      role: 'Editor',
      icon: 'md',
      mimeType: 'text/markdown',
    },
    {
      ext: 'html',
      name: 'HTML Document',
      role: 'Editor',
      icon: 'html',
      mimeType: 'text/html',
    },
    {
      ext: 'htm',
      name: 'HTML Document',
      role: 'Editor',
      icon: 'html',
      mimeType: 'text/html',
    },
  ],
  npmRebuild: false,
  mac: {
    // Two separate arch packages (NOT universal): arm64 keeps the exact
    // artifact names and update-feed entries it always had, x64 (opt-in via
    // GENOFFICE_MAC_X64=1, see includeMacX64 above) adds Intel support with
    // electron-builder's default arch-less names (FaamOffice-<v>.dmg /
    // FaamOffice-<v>-mac.zip). Both zips land in one latest-mac.yml and
    // electron-updater picks by process.arch. Dual-arch packs ship the same
    // lipo fat xlsx-sidecar (see assertUniversalSidecar above).
    target: [
      { target: 'dmg', arch: includeMacX64 ? ['arm64', 'x64'] : ['arm64'] },
      { target: 'zip', arch: includeMacX64 ? ['arm64', 'x64'] : ['arm64'] },
    ],
    category: 'public.app-category.productivity',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: true,
    extraResources: [
      {
        from: '../sheets/native/xlsx-engine/target/release/xlsx-sidecar',
        to: 'native/xlsx-sidecar',
      },
    ],
  },
  win: {
    target: [
      {
        target: 'nsis',
        arch: [winArch],
      },
    ],
    extraResources: [
      {
        from: WIN_SIDECAR,
        to: 'native/xlsx-sidecar.exe',
      },
      {
        from: 'build/shell-new',
        to: 'shell-new',
        filter: ['*.docx', '*.xlsx', '*.pptx'],
      },
    ],
  },
  // Unlike win (which cross-compiles the sidecar to an explicit target
  // triple), linux takes it from cargo's host-native target/release/ — the
  // same source mac uses. So no `arch` is pinned here: electron-builder
  // defaults to the build host's architecture, which is the only one the
  // sidecar was actually built for. Packaging arm64 on an x64 host, or the
  // reverse, needs a matching `cargo build --target` first.
  linux: {
    // AppImage (self-contained, any distro) + deb (apt install, pulls in the
    // GTK/NSS runtime deps) + rpm (dnf/zypper install on Fedora / RHEL /
    // openSUSE). Default artifact names are kept on purpose —
    // FaamOffice-<v>.AppImage / genoffice_<v>_amd64.deb — because the public
    // README download links and the already-published linux-v0.5.149 release
    // use them.
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
      { target: 'rpm', arch: ['x64'] },
    ],
    // deb control metadata; values match the manually published 0.5.149 deb
    // so apt sees the new packages as the same lineage. Homepage comes from
    // package.json "homepage"; the Package field is pinned in the deb block
    // below (packageName is a per-target option, rejected here by the schema).
    maintainer: 'FaamOffice <dinhthaicx@users.noreply.github.com>',
    vendor: 'FaamOffice <dinhthaicx@users.noreply.github.com>',
    category: 'Office',
    // Icon SET directory, not the single 1024px png: electron-builder does
    // not resize a lone png, so deb/rpm would install only
    // hicolor/1024x1024/apps/faamoffice.png — a size absent from the hicolor
    // theme index, leaving GNOME/KDE launchers on the generic fallback icon
    // (genspark-ai/genoffice#90). The set ships every standard raster size.
    icon: 'build/icons',
    // mac and win name the binary from productName; linux instead derives it
    // from package.json "name", and "@genoffice/shell" sanitizes to the
    // invalid "@genofficeshell". Setting it explicitly also makes the
    // generated faamoffice.desktop match the WM_CLASS Electron reports (it
    // takes that from the executable basename), so the running window links
    // back to its launcher entry.
    executableName: 'faamoffice',
    // Electron takes its X11 app_id from package.json "desktopName"
    // (faamoffice.desktop); syncDesktopName makes electron-builder name the
    // .desktop file and its StartupWMClass from the same value. Without it
    // StartupWMClass falls back to productName ("FaamOffice"), which does not
    // match the "faamoffice" WM_CLASS the window actually reports — and X11
    // compares case-sensitively, so the taskbar shows an unlinked window.
    syncDesktopName: true,
    extraResources: [
      {
        from: '../sheets/native/xlsx-engine/target/release/xlsx-sidecar',
        to: 'native/xlsx-sidecar',
      },
    ],
  },
  // Same "@genoffice/shell" problem as executableName above: the default deb
  // artifact name derives from package.json "name", and the scope's "/" makes
  // fpm treat "@genoffice" as a directory. Spell the published name out
  // (genoffice_<version>_amd64.deb, matching the linux-v0.5.149 release).
  // packageName pins the control Package field to the same value the 0.5.149
  // deb shipped with — apt treats a different Package name as an unrelated
  // install, breaking upgrades. Without it, fpm receives productName
  // "FaamOffice" and only happens to downcase it to the right value.
  // The updater finds a deb install through dpkg's file list for this
  // packageName (LINUX_PACKAGE_NAME in src/main/updater.ts).
  deb: {
    artifactName: 'faamoffice_${version}_${arch}.deb',
    packageName: 'faamoffice',
    // expose the faamoffice command line shipped inside the app
    afterInstall: 'build/linux-after-install.sh',
    afterRemove: 'build/linux-after-remove.sh',
  },
  // Same "@genoffice/shell" naming problem as deb: spell the artifact name
  // out (${arch} expands to the rpm arch string, x86_64) and pin the rpm
  // Package name so dnf/zypper treat successive releases as upgrades of the
  // same package. Like deb, rpm installs never update themselves: the app
  // only announces a new release and opens its package in the browser
  // (src/main/updater.ts) — users upgrade with `dnf install ./<new>.rpm`.
  // Packaging needs rpmbuild on the build host (the `rpm` apt package on
  // Ubuntu; CI installs it).
  //
  // publish: null (explicit) keeps the rpm out of latest-linux.yml, which
  // lists the AppImage (self-update) and the deb. The updater rebuilds the
  // rpm's release URL from the artifactName below, so keep the two in step.
  rpm: {
    artifactName: 'faamoffice-${version}.${arch}.rpm',
    packageName: 'faamoffice',
    publish: null,
    afterInstall: 'build/linux-after-install.sh',
    afterRemove: 'build/linux-after-remove.sh',
    // rpmbuild links every packaged ELF file into /usr/lib/.build-id/<hash>.
    // Two Electron apps built on the same Electron release ship identical
    // binaries, so the links are identical too and dnf refuses the install
    // with a file conflict against the other app (genoffice#1145). The links exist only
    // to locate detached debuginfo, which this package does not ship, so turn
    // them off. rpm-level `fpm` (not linux-level) keeps it away from the deb.
    fpm: ['--rpm-rpmbuild-define=_build_id_links none'],
  },
  nsis: {
    // No spaces: GitHub turns spaces in release asset names into dots, so the
    // default "FaamOffice Setup <v>.exe" would not match the name latest.yml
    // lists. scripts/release-feed.cjs refuses a feed whose files are missing.
    // A custom name also drops the -arm64 suffix the default adds for ARM64,
    // and the updater and the website (web/src/lib/releases.ts) tell the two
    // installers apart only by it, so the GENOFFICE_WIN_ARM64 pass spells it out.
    artifactName: winArm64
      ? '${productName}-Setup-${version}-arm64.${ext}'
      : '${productName}-Setup-${version}.${ext}',
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  beforePack: async (context) => {
    // without the Store identity electron-builder would fall back to the npm
    // package name, which no Store submission accepts
    if (!appxMode && context.targets.some((target) => target.name === 'appx')) {
      throw new Error('the appx target needs GENOFFICE_APPX=1 (npm run dist:win:store)')
    }
    ensurePlatformHelpers()
    assertExtraResourceSources()
    ensureThirdPartyNotices()
    assertModuleTreesPresent()
    ensureCliBundleCarriesAppVersion()
    if (context.electronPlatformName === 'darwin' && includeMacX64) {
      assertUniversalSidecar()
      assertUniversalVisionOcr()
    }
    if (context.electronPlatformName === 'win32' && !existsSync(join(__dirname, WIN_SIDECAR))) {
      throw new Error(
        `win extraResources source missing: ${WIN_SIDECAR} (cargo build --target ${winSidecarTarget} first)`,
      )
    }
  },
  dmg: {
    sign: true,
  },
  afterAllArtifactBuild: 'build/notarize-dmg.js',
}

// Windows in-package code signing. Security features that judge every PE
// individually (Smart App Control, WDAC/AppLocker, AV heuristics) block
// unsigned child processes — the unsigned xlsx-sidecar.exe died with
// "spawn UNKNOWN" on such machines even though the installer itself was
// signed. When CI exports GENOFFICE_WIN_SIGN_MODE ("test" = alpha
// self-signed PFX, "production" = DigiCert KeyLocker — the two modes of
// scripts/win-sign.cjs, whose env-var contract applies here too), every
// binary electron-builder signs for win (FaamOffice.exe, the NSIS
// uninstaller, and the installer) goes through that script. The static
// extraResources binaries (xlsx-sidecar.exe, win-ocr.exe) are signed by the
// workflow before packaging since electron-builder does not sign
// extraResources. Unset (local / fork builds) keeps the old behavior:
// electron-builder has no signing config and packages everything unsigned.
// The Store appx is never signed here (see the appx block below).
const winSignMode = process.env.GENOFFICE_WIN_SIGN_MODE
if (winSignMode && !appxMode) {
  if (winSignMode !== 'test' && winSignMode !== 'production') {
    throw new Error(`GENOFFICE_WIN_SIGN_MODE must be "test" or "production", got "${winSignMode}"`)
  }
  config.win.signtoolOptions = {
    // Single pass per file: the sha1+sha256 dual-signing default is a
    // pre-Win8 relic and would invoke the hook twice per binary.
    signingHashAlgorithms: ['sha256'],
    sign: (configuration) => {
      execFileSync(
        process.execPath,
        [join(__dirname, '../../scripts/win-sign.cjs'), winSignMode, configuration.path],
        { stdio: 'inherit' },
      )
      return Promise.resolve()
    },
  }
}

if (updateUrl && !appxMode) {
  config.publish = [
    {
      provider: 'generic',
      url: updateUrl,
      channel: 'latest',
    },
  ]
}

// FaamOffice builds without an Apple Developer ID (CSC_LINK / CSC_NAME unset)
// are ad-hoc signed so the app still launches on Apple Silicon, where macOS
// refuses unsigned arm64 code. Ad-hoc code carries no team id, so the hardened
// runtime's library validation would reject Electron's own frameworks: it is
// switched off together with notarization and dmg signing, which need the
// certificate anyway.
if (!process.env.CSC_LINK && !process.env.CSC_NAME) {
  config.mac.identity = '-'
  config.mac.hardenedRuntime = false
  config.mac.notarize = false
  config.dmg.sign = false
}

// CI's "-c.extraMetadata.version=..." CLI override deep-merges with this block,
// so the version and all injected feature settings survive together.
const extraMetadata = {}
if (ga4MeasurementId && ga4ApiSecret) {
  extraMetadata.genofficeAnalytics = {
    measurementId: ga4MeasurementId,
    apiSecret: ga4ApiSecret,
  }
}
if (fontCdnUrl) extraMetadata.genofficeFontCdn = { baseUrl: fontCdnUrl }
// FAAMOFFICE_ACCOUNT_URL — the FaamOffice account server (web/) this build signs
// in to by default; users can still point Settings → Profile at another one.
const faamAccountUrl = normalizeHttpsBaseUrl(
  'FAAMOFFICE_ACCOUNT_URL',
  process.env.FAAMOFFICE_ACCOUNT_URL,
)
if (faamAccountUrl) extraMetadata.faamofficeAccount = { baseUrl: faamAccountUrl }

// Microsoft Store package (GENOFFICE_APPX=1). The tiles in build/appx
// (tools/gen-appx-assets.mjs) are transparent, so the white BackgroundColor is
// the plate Start draws behind them. The app's fileAssociations become one
// uap:FileTypeAssociation per extension; their ProgIds are generated by
// Windows, which is why the Store build finds itself by AUMID
// (src/main/default-app.ts). Nothing here is signed — the Store signs the
// package — and publish: null keeps app-update.yml out even on tag builds,
// where GENOFFICE_UPDATE_URL is set for the whole job (and stops
// electron-builder from inferring a provider from a token).
if (appxMode) {
  config.win.target = [{ target: 'appx', arch: ['x64'] }]
  config.win.signExecutable = false
  config.appx = {
    identityName: STORE_IDENTITY_NAME,
    publisher: STORE_PUBLISHER,
    publisherDisplayName: STORE_PUBLISHER_DISPLAY_NAME,
    applicationId: STORE_APPLICATION_ID,
    displayName: 'FaamOffice',
    backgroundColor: '#FFFFFF',
    showNameOnTiles: false,
    languages: ['en-US', 'vi-VN'],
    minVersion: '10.0.17763.0',
    artifactName: 'FaamOffice-${version}-store.${ext}',
  }
  config.publish = null
  // read back by src/main/ms-store.ts
  extraMetadata.faamofficeStore = {
    productId: STORE_PRODUCT_ID,
    aumid: `${STORE_PACKAGE_FAMILY_NAME}!${STORE_APPLICATION_ID}`,
  }
}
if (Object.keys(extraMetadata).length) config.extraMetadata = extraMetadata

module.exports = config
