#!/usr/bin/env node
// Stapling a notarization ticket changes DMG bytes after electron-builder has
// calculated its update metadata. Refresh blockmaps and the feed only after
// afterAllArtifactBuild has finished, before uploading any release assets.
const { readFileSync, writeFileSync, renameSync, existsSync } = require('node:fs')
const { createRequire } = require('node:module')
const path = require('node:path')
const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'))
const { load, dump } = builderRequire('js-yaml')
const { buildBlockMap } = builderRequire('./out/targets/blockmap/blockmap.js')

function fileName(ref) {
  const name = decodeURIComponent(new URL(ref, 'https://feed.invalid/').pathname.split('/').pop())
  if (!name || path.basename(name) !== name || !/\.(dmg|zip)$/.test(name)) {
    throw new Error(`Invalid macOS update artifact: ${ref}`)
  }
  return name
}

async function refreshMacUpdateFeed(dir) {
  const feedPath = path.join(dir, 'latest-mac.yml')
  // Contributor builds without a publish URL have no update feed.
  if (!existsSync(feedPath)) return []
  const feed = load(readFileSync(feedPath, 'utf8'))
  if (!Array.isArray(feed?.files) || !feed.files.length) {
    throw new Error('latest-mac.yml lists no artifacts')
  }
  const paths = feed.files.map((entry) => path.join(dir, fileName(entry.url)))
  for (const file of paths) {
    if (!existsSync(file)) throw new Error(`Missing macOS update artifact: ${file}`)
  }
  const primaryName = fileName(feed.path)
  if (!paths.some((file) => path.basename(file) === primaryName)) {
    throw new Error('latest-mac.yml path is not listed in files')
  }
  const metadata = new Map()
  for (const [index, file] of paths.entries()) {
    const info = await buildBlockMap(file, 'gzip', `${file}.blockmap`)
    Object.assign(feed.files[index], { sha512: info.sha512, size: info.size })
    metadata.set(path.basename(file), info)
  }
  feed.sha512 = metadata.get(primaryName).sha512
  writeFileSync(`${feedPath}.tmp`, dump(feed, { lineWidth: -1 }))
  renameSync(`${feedPath}.tmp`, feedPath)
  return paths
}

if (require.main === module) {
  const dir = path.resolve(process.argv[2] || process.env.BUILD_DIR || 'release')
  refreshMacUpdateFeed(dir)
    .then((files) => console.log(`macOS update metadata refreshed: ${files.length} artifacts`))
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
}

module.exports = { refreshMacUpdateFeed }
