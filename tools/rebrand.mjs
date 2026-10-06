/**
 * Applies the FaamOffice branding on top of an upstream GenOffice checkout.
 *
 * Idempotent: run it again after merging upstream/main so new upstream code
 * picks up the same renames. It only rewrites user-facing names; everything
 * the Genspark backend or saved documents depend on keeps its upstream value.
 *
 *   node tools/rebrand.mjs [--owner <github-user>] [--dry-run]
 *
 * Renamed:
 *   - "GenOffice" as a standalone word          -> "FaamOffice"
 *   - the `genoffice` command line / skill name -> `faamoffice`
 *   - app id com.genoffice.app                  -> com.faamoffice.app
 *   - per-user config dir ~/.genoffice          -> ~/.faamoffice
 *   - upstream repo links                       -> github.com/<owner>/faamoffice
 *   - the editors' AI assistant "Genspark"      -> "Faam AI" (title, ribbon, mark)
 *
 * Kept on purpose:
 *   - npm workspace scope @genoffice/* and GENOFFICE_* env vars (internal;
 *     renaming them only makes every upstream merge conflict)
 *   - Genspark protocol identifiers (app_type, agent type, key_name, the
 *     default User-Agent): the Genspark login and AI proxy key off them
 *   - identifiers embedded in documents (font families such as
 *     GenOfficePoppins, `genoffice:brief` meta, `_GenOfficeCoverPage`
 *     bookmarks), the genoffice.ai domain, and links to upstream issues
 *   - LICENSE, NOTICE and Mainfunc's own policy documents
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const ownerIdx = args.indexOf('--owner')
const owner = ownerIdx >= 0 ? args[ownerIdx + 1] : 'dinhthaicx'
if (!owner || !/^[A-Za-z0-9-]+$/.test(owner)) throw new Error('--owner must be a GitHub login')

const SKIP_PATHS = [
  /^LICENSE/,
  /^NOTICE$/,
  /^PRIVACY\.md$/,
  /^SECURITY\.md$/,
  /^CODE_OF_CONDUCT\.md$/,
  /^CONTRIBUTING\.md$/,
  /^README\.md$/,
  /^ee\//,
  // the website keeps its own copy (it credits GenOffice by name)
  /^web\//,
  /^docs\//,
  /^fixtures\//,
  /\/fixtures\//,
  /^package-lock\.json$/,
  /^tools\/rebrand\.mjs$/,
  /\.(woff2?|ttf|otf|png|jpe?g|gif|webp|ico|icns|pdf|docx|xlsx|pptx|zip|wasm)$/i,
]

// Lines that carry Genspark protocol values: never touched.
const PROTECTED_LINE =
  /APP_TYPE|KEY_NAME|GENSPARK_AGENT_TYPE|X-Agent-Type|app_type|key_name|agent_type/

const REPO_URL = `github.com/${owner}/faamoffice`

/**
 * Bundled font families and CSS font aliases ("GenOffice Serif KR",
 * "GenOffice Batang", …). They are font identifiers, not branding: the KR/JP
 * font files carry them in their name tables, and the paste/export paths
 * recognise them by name to keep them out of saved documents.
 */
const FONT_ALIASES = [
  'Batang',
  'Box Drawing',
  'Che Latin KR',
  'Ethiopic',
  'Fullwidth TC',
  'Gothic KR',
  'Grid Strut',
  'Hangul Space',
  'Heiti TC',
  'Hiragino Mincho',
  'Hiragino Sans',
  'MS Mincho',
  'MingLiU',
  'Myungjo',
  'PUA Blank',
  'Poppins',
  'Sans KR',
  'Serif KR',
  'SimSun Latin',
  'Songti SC',
  'Songti TC',
  'Tamil',
  'UI Kana',
  'YaHei Latin',
].join('|')

/** Ordered rewrites applied to every unprotected line. */
const RULES = [
  // linux package maintainer and the onboarding community link
  [/Mainfunc, Inc\. <team@genspark\.ai>/g, `FaamOffice <${owner}@users.noreply.github.com>`],
  [/'https:\/\/genoffice\.ai\/join'/g, `'https://${REPO_URL}/issues'`],
  [/'https:\/\/github\.com\/[\w-]+\/faamoffice\/discussions'/g, `'https://${REPO_URL}/issues'`],
  // upstream repo links (issue/PR links stay: they document upstream history)
  [/github\.com\/genspark-ai\/genoffice(?!\/(?:issues|pull)\b)(?![\w-])/g, REPO_URL],
  [/repos\/genspark-ai\/genoffice(?![\w-])/g, `repos/${owner}/faamoffice`],
  [/skills add genspark-ai\/genoffice(?![\w-])/g, `skills add ${owner}/faamoffice`],
  // `genoffice#123` comments cite upstream issues and keep doing so
  [/\bfaamoffice#(?=\d)/g, 'genoffice#'],
  [/github\.com\/(?!genspark-ai\/)[\w-]+\/faamoffice(?![\w-])/g, REPO_URL],
  // app id (mac bundle id, Windows AppUserModelID, flatpak id)
  [/\bcom\.genoffice\.app\b/g, 'com.faamoffice.app'],
  // per-user config dir
  [/(['"`/~])\.genoffice(?=['"`/\s)\\]|$)/g, '$1.faamoffice'],
  // the MCP server entry agents read: TOML tables, JSON keys, test regexes
  [/\b(mcp_servers|mcpServers|mcp)\.genoffice\b/g, '$1.faamoffice'],
  [/\\\.genoffice\b/g, '\\.faamoffice'],
  // command line, skill, launcher and linux package names; a `genoffice:` or
  // `genoffice-` followed by an identifier is an internal event/id and stays
  [
    /(?<![@\w.$-])(?<!genspark-ai\/)genoffice(?=$|[^\w:.#-]|:\s|:\/\/|\.(?:cmd|cjs|command|desktop|png|exe)\b|_\$\{)/g,
    'faamoffice',
  ],
  // compounds naming the command line in prose and package file names
  [
    /(?<![@\w.$-])genoffice-(?=\$\{version\}|<version>|opdrachtregel|Befehlszeile|Kommandozeile|skill|Skill|MCP-Server)/g,
    'faamoffice-',
  ],
  // the paste path spots every alias by this prefix (apps/docs editor/marks.ts)
  [/\/\^faamoffice \/i\.test\(/g, '/^genoffice /i.test('],
  [/'FaamOffice \*'/g, "'GenOffice *'"],
  // display name; bundled font families ("GenOffice Serif KR", …) are font
  // identifiers baked into the font files' name tables and stay as they are
  [new RegExp(`\\bFaamOffice (?=(?:${FONT_ALIASES})\\b)`, 'g'), 'GenOffice '],
  [new RegExp(`(?<![\\w$])GenOffice(?![\\w$])(?! (?:${FONT_ALIASES})\\b)`, 'g'), 'FaamOffice'],
]

// The Genspark mark as the upstream editors inline it, and the Faam AI mark
// that replaces it: the FaamOffice ring and dot in one colour (the inner
// circle is wound counter-clockwise so the default nonzero fill leaves it open;
// the ring is a little heavier than the logo's so it holds up at 18 px).
const GENSPARK_MARK_PATH = /d="M105\.115 0H24\.6428C11\.0443 0 0 11\.0686[^"]*"/g
const FAAM_AI_MARK_PATH =
  'd="M2.76 66.56A58.5 58.5 0 1 1 119.76 66.56A58.5 58.5 0 1 1 2.76 66.56Z' +
  'M13.76 66.56A47.5 47.5 0 1 0 108.76 66.56A47.5 47.5 0 1 0 13.76 66.56Z' +
  'M107.09 13.86A11 11 0 1 1 129.09 13.86A11 11 0 1 1 107.09 13.86Z"'
// earlier FaamOffice builds drew an F and a spark; upgrade those in place too
const EARLIER_FAAM_AI_MARK_PATH = /d="M29 0H100\.758A29 29 0 0 1 129\.758 29V101\.025[^"]*"/g
const EDITOR_RENDERER = /^apps\/(docs|html|markdown|pdf|sheets|slides)\/(src\/renderer|tests)\//
const AI_PANEL = /\/ai\/(AiPanel|AiChatPanel)\.tsx$/

/**
 * The assistant is branded "Faam AI" in the editors. Strings that name the
 * Genspark service itself (sign-in, credits, cloud projects) keep "Genspark".
 * Each rule: [pattern, replacement, optional path filter].
 */
const AI_RULES = [
  [/\bGensparkMark\b/g, 'FaamAiMark', /^apps\//],
  [GENSPARK_MARK_PATH, FAAM_AI_MARK_PATH, /^apps\//],
  [EARLIER_FAAM_AI_MARK_PATH, FAAM_AI_MARK_PATH, /^apps\//],
  [
    /(?:Genspark brand mark \(rounded-square sparkle badge\)|Faam AI mark \(an F and a spark on a rounded square\))/g,
    'Faam AI mark (the FaamOffice ring and dot)',
    /^apps\//,
  ],
  [/\b(aiPanelTitle|ribbonAiAssistant): 'Genspark'/g, "$1: 'Faam AI'", /^apps\//],
  [/\bGenspark AI\b/g, 'Faam AI', EDITOR_RENDERER],
  [/^(\s+)Genspark$/g, '$1Faam AI', AI_PANEL],
  // onboarding: GenOffice's GenTeam chat becomes feedback on the fork's GitHub
  [
    /'FaamOffice is still in alpha\. Join the group chat on GenTeam to share feedback and help shape what comes next\.'/g,
    "'FaamOffice is still in alpha. Share feedback and report problems on GitHub to help shape what comes next.'",
  ],
  [
    /'FaamOffice vẫn đang trong giai đoạn alpha\. Hãy tham gia nhóm trò chuyện trên GenTeam để chia sẻ phản hồi và định hình những bước phát triển tiếp theo\.'/g,
    "'FaamOffice vẫn đang trong giai đoạn alpha. Hãy góp ý và báo lỗi trên GitHub để cùng định hình những bước phát triển tiếp theo.'",
  ],
  [/onbJoinGenTeam: 'Join GenTeam'/g, "onbJoinGenTeam: 'Give feedback on GitHub'"],
  [/onbJoinGenTeam: 'Tham gia GenTeam'/g, "onbJoinGenTeam: 'Góp ý trên GitHub'"],
  [/\bGenTeam\b(?=[^']*',?$)/g, 'GitHub', /\/renderer\/src\/strings\.ts$/],
  // the main assistant prompts introduce the assistant by name
  [
    /You are the document assistant built into/g,
    'You are Faam AI, the document assistant built into',
  ],
  [/You are the assistant inside FaamOffice/g, 'You are Faam AI, the assistant inside FaamOffice'],
  [/You are the writing assistant inside/g, 'You are Faam AI, the writing assistant inside'],
  [/You are FaamOffice's PDF assistant/g, "You are Faam AI, FaamOffice's PDF assistant"],
  [
    /You are the AI assistant inside FaamOffice/g,
    'You are Faam AI, the AI assistant inside FaamOffice',
  ],
  [
    /^You are an AI assistant embedded in an Excel-compatible desktop spreadsheet app\./g,
    'You are Faam AI, the AI assistant embedded in FaamOffice Sheets, an Excel-compatible desktop spreadsheet app.',
  ],
]

/** a file is only read when it contains one of these (every rule's trigger) */
const CANDIDATE_PATTERNS = [
  'GenOffice',
  'genoffice',
  'Genspark',
  'GenTeam',
  'You are ',
  'faamoffice/discussions',
  'faamoffice#',
  'FaamOffice ',
  'faamoffice /i',
  'FaamAiMark',
]

function trackedTextFiles() {
  const out = execFileSync(
    'git',
    ['grep', '-I', '-l', ...CANDIDATE_PATTERNS.flatMap((p) => ['-e', p])],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  return out
    .split('\n')
    .filter(Boolean)
    .filter((p) => !SKIP_PATHS.some((re) => re.test(p)))
}

function rewrite(text, rel) {
  let changes = 0
  const aiRules = AI_RULES.filter(([, , only]) => !only || only.test(rel))
  let previous = ''
  const lines = text.split('\n').map((line) => {
    const prev = previous
    previous = line
    if (PROTECTED_LINE.test(line)) return line
    // a value wrapped onto the line after a protected key (`toBe(\n  'genoffice',`)
    if (PROTECTED_LINE.test(prev) && /^\s*'[^']*',?\s*$/.test(line)) return line
    let next = line
    for (const [re, to] of RULES) next = next.replace(re, to)
    for (const [re, to] of aiRules) next = next.replace(re, to)
    if (next !== line) changes++
    return next
  })
  return { text: lines.join('\n'), changes }
}

let files = 0
let lines = 0
for (const rel of trackedTextFiles()) {
  const abs = join(root, rel)
  const before = readFileSync(abs, 'utf8')
  const { text, changes } = rewrite(before, rel)
  if (!changes) continue
  files++
  lines += changes
  if (!dryRun) writeFileSync(abs, text)
}

// Files whose names are part of the command line / packaging layout.
const MOVES = [
  ['packages/cli/bin/genoffice', 'packages/cli/bin/faamoffice'],
  ['packages/cli/bin/genoffice.cmd', 'packages/cli/bin/faamoffice.cmd'],
  ['skills/genoffice', 'skills/faamoffice'],
  [
    'apps/shell/src/renderer/src/assets/genoffice-logo.svg',
    'apps/shell/src/renderer/src/assets/faamoffice-logo.svg',
  ],
  ['packaging/flatpak/com.genoffice.app.desktop', 'packaging/flatpak/com.faamoffice.app.desktop'],
  ['packaging/flatpak/com.genoffice.app.json', 'packaging/flatpak/com.faamoffice.app.json'],
  [
    'packaging/flatpak/com.genoffice.app.metainfo.xml',
    'packaging/flatpak/com.faamoffice.app.metainfo.xml',
  ],
  ['packaging/flatpak/genoffice.sh', 'packaging/flatpak/faamoffice.sh'],
  ['packaging/nix/genoffice.nix', 'packaging/nix/faamoffice.nix'],
]
let moved = 0
for (const [from, to] of MOVES) {
  if (!existsSync(join(root, from)) || existsSync(join(root, to))) continue
  moved++
  if (!dryRun) execFileSync('git', ['mv', from, to], { cwd: root })
}
// the logo import follows the file rename
const home = join(root, 'apps/shell/src/renderer/src/Home.tsx')
if (!dryRun && existsSync(home)) {
  const src = readFileSync(home, 'utf8')
  const next = src.replace('./assets/genoffice-logo.svg', './assets/faamoffice-logo.svg')
  if (next !== src) writeFileSync(home, next)
}

console.log(
  `${dryRun ? '[dry-run] ' : ''}rebrand: ${lines} lines in ${files} files rewritten, ${moved} paths moved (owner ${owner})`,
)
