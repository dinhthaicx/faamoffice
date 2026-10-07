#!/usr/bin/env node
/**
 * scripts/release-feed.cjs — turns the electron-updater feed files of a tag
 * build into the GitHub Releases feed installed apps read
 * (https://github.com/<repo>/releases/latest/download/latest*.yml, see
 * apps/shell/src/main/updater.ts). Used by the publish job of
 * .github/workflows/release.yml while the release is still a draft:
 *
 *   node scripts/release-feed.cjs prepare --dir dist --out feed \
 *     --tag v0.12.0 --repo owner/name --assets release-assets.txt
 *     Requires latest.yml, latest-mac.yml and latest-linux.yml in --dir, each
 *     with `version` equal to the tag; requires every file they reference to
 *     be an asset of the release (--assets: one name per line) and, when the
 *     file is also in --dir, to match the feed's sha512 and size; rewrites
 *     every url/path to the tag-pinned
 *     https://github.com/<repo>/releases/download/<tag>/<file> and writes the
 *     result to --out. Pinned URLs keep a download valid while
 *     releases/latest moves on to a newer release mid-update.
 *
 *   node scripts/release-feed.cjs latest --tag v0.12.0 --current v0.11.1
 *     Prints "true" when the release may become GitHub's Latest (the stable
 *     feed): a final version newer than --current (the Latest release's tag,
 *     empty when there is none). A backport or a slow run of an older tag
 *     never takes the feed back; a prerelease never takes it at all.
 *
 * Dependency-free (no npm install in the publish job); the feed files are the
 * flat YAML electron-builder writes, edited line by line so every other field
 * is kept byte for byte.
 */

const { createHash } = require('node:crypto')
const { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const { semverNewer, ymlVersion } = require('./update-feed-utils.cjs')

const REQUIRED_FEEDS = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml']
const TAG = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/
const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/
/** a file reference: a `files:` item (`  - url: x`) or the top-level `path: x` */
const REF_LINE = /^(\s*-\s+(?=url:)|(?=path:))(url|path):[ \t]*(.*?)[ \t]*$/

class FeedError extends Error {}

/** the release version a v-tag names */
function tagVersion(tag) {
  const match = TAG.exec(String(tag))
  if (!match) throw new FeedError(`tag ${tag} is not v<major>.<minor>.<patch>[-prerelease]`)
  return match[1]
}

/** a YAML scalar as electron-builder (js-yaml) writes it: plain, '…' or "…" */
function unquote(raw) {
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'"))
    return raw.slice(1, -1).replace(/''/g, "'")
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) return JSON.parse(raw)
  return raw
}

/** basename a feed entry points at (relative name or an absolute URL) */
function fileNameOf(ref) {
  const pathname = new URL(ref, 'https://feed.invalid/').pathname
  return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1))
}

function assetUrl(repo, tag, name) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`
}

/**
 * The files entries of one feed: { name, sha512, size } per `- url:` item.
 * Items are the indented blocks under `files:` (js-yaml block style).
 */
function listFiles(text) {
  const files = []
  let current = null
  let inFiles = false
  for (const line of text.split(/\r?\n/)) {
    if (/^files:\s*$/.test(line)) {
      inFiles = true
      continue
    }
    if (/^\S/.test(line)) {
      inFiles = false
      current = null
      continue
    }
    if (!inFiles) continue
    const item = /^\s*-\s+url:[ \t]*(.*?)[ \t]*$/.exec(line)
    if (item) {
      current = { name: fileNameOf(unquote(item[1])) }
      files.push(current)
      continue
    }
    const field = /^\s+(sha512|size):[ \t]*(.*?)[ \t]*$/.exec(line)
    if (field && current) current[field[1]] = unquote(field[2])
  }
  return files
}

function sha512Base64(file) {
  return createHash('sha512').update(readFileSync(file)).digest('base64')
}

/**
 * Validate one feed and return it with every url/path pinned to the tag.
 * `assets` is the set of names already uploaded to the release; `dir`, when
 * given, holds local copies to check against the feed's sha512 / size.
 */
function rewriteFeed(text, { feed, tag, repo, assets, dir }) {
  const version = tagVersion(tag)
  const declared = ymlVersion(text)
  const found = declared === null ? null : unquote(declared)
  if (found !== version) {
    throw new FeedError(`${feed}: version ${found ?? '(missing)'} does not match tag ${tag}`)
  }
  const referenced = new Set()
  const lines = text.split(/\r?\n/).map((line) => {
    const match = REF_LINE.exec(line)
    if (!match) return line
    const [, lead, key, raw] = match
    if (!raw) throw new FeedError(`${feed}: empty ${key}`)
    const name = fileNameOf(unquote(raw))
    if (!name) throw new FeedError(`${feed}: ${key} ${raw} names no file`)
    referenced.add(name)
    return `${lead}${key}: ${assetUrl(repo, tag, name)}`
  })
  if (referenced.size === 0) throw new FeedError(`${feed}: lists no files`)
  for (const name of referenced) {
    if (!assets.has(name)) throw new FeedError(`${feed}: ${name} is not an asset of release ${tag}`)
  }
  if (dir) {
    for (const entry of listFiles(text)) {
      const local = path.join(dir, entry.name)
      if (!existsSync(local)) continue
      if (entry.size !== undefined && Number(entry.size) !== statSync(local).size) {
        throw new FeedError(
          `${feed}: ${entry.name} is ${statSync(local).size} bytes, the feed says ${entry.size}`,
        )
      }
      if (entry.sha512 !== undefined && entry.sha512 !== sha512Base64(local)) {
        throw new FeedError(`${feed}: ${entry.name} does not match the sha512 the feed lists`)
      }
    }
  }
  return { text: lines.join('\n'), files: [...referenced] }
}

/** validate + rewrite every required feed of `dir` into `out` */
function prepare({ dir, out, tag, repo, assetNames }) {
  if (!REPO.test(String(repo))) throw new FeedError(`repository ${repo} is not owner/name`)
  tagVersion(tag)
  const assets = new Set(assetNames.map((name) => name.trim()).filter(Boolean))
  mkdirSync(out, { recursive: true })
  const written = []
  for (const feed of REQUIRED_FEEDS) {
    const source = path.join(dir, feed)
    if (!existsSync(source)) throw new FeedError(`${feed} is missing from ${dir}`)
    const { text } = rewriteFeed(readFileSync(source, 'utf8'), { feed, tag, repo, assets, dir })
    const target = path.join(out, feed)
    writeFileSync(target, text)
    written.push(target)
  }
  return written
}

/** whether release `tag` may become GitHub's Latest over `currentTag` */
function shouldMarkLatest(tag, currentTag) {
  const version = tagVersion(tag)
  if (version.includes('-')) return false
  const current = String(currentTag ?? '').trim()
  if (!current || current === tag) return true
  const currentVersion = current.replace(/^v/, '')
  // an unrecognisable Latest (a hand-made release) must not freeze the feed
  if (!TAG.test(`v${currentVersion}`)) return true
  return semverNewer(version, currentVersion)
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i]
    if (!key.startsWith('--')) throw new FeedError(`unexpected argument ${key}`)
    const value = rest[i + 1]
    if (value === undefined || value.startsWith('--')) {
      options[key.slice(2)] = ''
    } else {
      options[key.slice(2)] = value
      i++
    }
  }
  return { command, options }
}

function main(argv) {
  const { command, options } = parseArgs(argv)
  if (command === 'prepare') {
    for (const required of ['dir', 'out', 'tag', 'repo', 'assets']) {
      if (!options[required]) throw new FeedError(`prepare needs --${required}`)
    }
    const assetNames = readFileSync(options.assets, 'utf8').split(/\r?\n/)
    for (const file of prepare({ ...options, assetNames })) console.log(`feed ready: ${file}`)
    return
  }
  if (command === 'latest') {
    if (!options.tag) throw new FeedError('latest needs --tag')
    console.log(shouldMarkLatest(options.tag, options.current) ? 'true' : 'false')
    return
  }
  throw new FeedError('usage: release-feed.cjs prepare|latest [options] (see the file header)')
}

if (require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`release-feed: ${error.message}`)
    process.exit(1)
  }
}

module.exports = {
  FeedError,
  REQUIRED_FEEDS,
  assetUrl,
  listFiles,
  prepare,
  rewriteFeed,
  shouldMarkLatest,
  tagVersion,
}
