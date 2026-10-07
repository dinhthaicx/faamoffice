import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The update-feed rules of .github/workflows/release.yml: only tag builds bake
 * the feed, no token reaches electron-builder, the feed files are uploaded,
 * and the publish job keeps the release a draft until its feed is complete
 * and moves Latest one tag at a time. The Microsoft Store appx is a separate,
 * best-effort run artifact that never reaches the release. scripts/release-feed.cjs
 * itself is release-feed.test.ts's subject.
 */

// js-yaml as electron-updater (a shell dependency) resolves it
const require = createRequire(import.meta.url)
const { load } = createRequire(require.resolve('electron-updater'))('js-yaml') as {
  load: (text: string) => unknown
}
// the matcher actions/download-artifact applies to its `pattern` input
const { minimatch } = require('minimatch') as {
  minimatch: (name: string, pattern: string) => boolean
}

const shellPackage = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'),
) as { scripts: Record<string, string> }

interface Step {
  name?: string
  id?: string
  if?: string
  run?: string
  uses?: string
  env?: Record<string, string>
  with?: Record<string, string | number>
  'continue-on-error'?: boolean
  'timeout-minutes'?: number
}

interface Job {
  needs?: string | string[]
  if?: string
  env?: Record<string, string>
  concurrency?: { group: string; 'cancel-in-progress'?: boolean }
  steps: Step[]
}

interface Workflow {
  on: { workflow_dispatch?: unknown; push?: { tags?: string[] } }
  env?: Record<string, string>
  concurrency?: { group: string }
  jobs: { build: Job; publish: Job }
}

const workflow = load(
  readFileSync(resolve(import.meta.dirname, '../../../.github/workflows/release.yml'), 'utf8'),
) as Workflow
const { build, publish } = workflow.jobs

/** index of the first publish step whose script matches */
function stepIndex(pattern: RegExp): number {
  const index = publish.steps.findIndex((step) => pattern.test(step.run ?? ''))
  expect(index, `no publish step runs ${pattern}`).toBeGreaterThanOrEqual(0)
  return index
}

describe('release workflow: build job', () => {
  it('runs for v* tags and by hand', () => {
    expect(workflow.on.push?.tags).toEqual(['v*'])
    expect(workflow.on).toHaveProperty('workflow_dispatch')
  })

  it('bakes the GitHub Releases feed into tag builds only', () => {
    const feed = build.env?.GENOFFICE_UPDATE_URL ?? ''
    expect(feed).toMatch(
      /^\$\{\{ startsWith\(github\.ref, 'refs\/tags\/v'\) && format\('https:\/\/github\.com\/\{0\}\/releases\/latest\/download', github\.repository\) \|\| '' \}\}$/,
    )
  })

  it('keeps every token away from electron-builder', () => {
    // with GH_TOKEN / GITHUB_TOKEN set and no publish config (non-tag builds),
    // electron-builder infers a GitHub provider and bakes it in
    const token = /\bGH_TOKEN\b|\bGITHUB_TOKEN\b|github\.token|secrets\.GITHUB_TOKEN/
    expect(JSON.stringify(workflow.env ?? {})).not.toMatch(token)
    expect(JSON.stringify(build)).not.toMatch(token)
  })

  it('packages through the dist scripts (which pass --publish never)', () => {
    const runs = build.steps.map((step) => step.run ?? '')
    for (const platform of ['mac', 'win', 'linux']) {
      expect(runs).toContainEqual(`npm run dist:${platform}`)
    }
    // never a direct electron-builder call, which could publish on its own
    expect(runs.join('\n')).not.toMatch(/electron-builder/)
  })

  it('uploads the feed files and blockmaps, never builder-debug.yml', () => {
    const upload = build.steps.find((step) => step.uses?.startsWith('actions/upload-artifact'))
    const paths = String(upload?.with?.path ?? '')
      .split('\n')
      .map((line) => line.trim())
    expect(paths).toContain('apps/shell/release/latest*.yml')
    expect(paths).toContain('apps/shell/release/*.blockmap')
    // a broader yml glob would ship builder-debug.yml too
    expect(paths.filter((path) => path.endsWith('.yml'))).toEqual([
      'apps/shell/release/latest*.yml',
    ])
  })
})

describe('release workflow: publish job', () => {
  it('runs only for tags, after the builds, with the token it needs', () => {
    expect(publish.needs).toBe('build')
    expect(publish.if).toBe("startsWith(github.ref, 'refs/tags/v')")
    expect(publish.env?.GH_TOKEN).toBe('${{ github.token }}')
  })

  it('publishes one tag at a time (Latest is read, then edited)', () => {
    // the workflow-level group is per ref, which would let two tags race
    expect(workflow.concurrency?.group).toContain('github.ref')
    expect(publish.concurrency?.group).toBeTruthy()
    expect(publish.concurrency?.group).not.toMatch(/\$\{\{/)
    expect(publish.concurrency?.['cancel-in-progress']).toBe(false)
  })

  it('creates a draft, completes its feed, then publishes and checks the feed', () => {
    const draft = stepIndex(/gh release create "\$TAG"/)
    const feed = stepIndex(/release-feed\.cjs prepare/)
    const latest = stepIndex(/release-feed\.cjs latest/)
    const edit = stepIndex(/gh release edit "\$TAG"/)
    const smoke = stepIndex(/curl .*latest\.yml/)
    expect(draft).toBeLessThan(feed)
    expect(feed).toBeLessThan(edit)
    expect(latest).toBeLessThanOrEqual(edit)
    expect(edit).toBeLessThan(smoke)

    const create = publish.steps[draft]!.run!
    expect(create).toMatch(/--draft\b/)
    // the feed files go up only once validated; builder-debug.yml never
    expect(create).toContain("! -name 'latest*.yml'")
    expect(create).toContain("! -name 'builder-debug.yml'")
    expect(create).toContain('if [[ "$TAG" == *-* ]]; then prerelease=(--prerelease); fi')

    const upload = publish.steps[feed]!.run!
    expect(upload).toMatch(
      /gh release upload "\$TAG" feed\/latest\.yml feed\/latest-mac\.yml feed\/latest-linux\.yml[\s\S]*--clobber/,
    )

    const release = publish.steps[edit]!.run!
    expect(release).toMatch(/--draft=false/)
    expect(release).toMatch(/--latest="\$latest"/)
  })
})

describe('release workflow: Microsoft Store appx', () => {
  const stepAt = (find: (step: Step) => boolean): number => {
    const index = build.steps.findIndex(find)
    expect(index).toBeGreaterThanOrEqual(0)
    return index
  }
  const appx = () => build.steps[stepAt((step) => step.env?.GENOFFICE_APPX === '1')]!
  const appxUpload = () =>
    build.steps[stepAt((step) => step.with?.name === 'faamoffice-store-appx')]!
  const installersUpload = () =>
    build.steps[
      stepAt(
        (step) =>
          step.uses?.startsWith('actions/upload-artifact') === true &&
          String(step.with?.name).startsWith('faamoffice-${{ matrix.platform }}'),
      )
    ]!
  const paths = (step: Step) =>
    String(step.with?.path ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

  it('packages the appx on Windows through the never-publishing Store script', () => {
    const step = appx()
    expect(step.if).toBe("matrix.platform == 'win'")
    expect(step.run).toBe('npm run dist:win:store -w @genoffice/shell')
    expect(shellPackage.scripts['dist:win:store']).toMatch(
      /electron-builder --win appx --x64 --publish never$/,
    )
    // its own output directory: nothing it writes lands next to the installers
    expect(step.env?.BUILD_DIR).toBe('release/store')
  })

  it('runs after the NSIS installer is packaged and uploaded', () => {
    const nsis = stepAt((step) => step.run === 'npm run dist:win')
    const installers = build.steps.indexOf(installersUpload())
    const store = build.steps.indexOf(appx())
    const upload = build.steps.indexOf(appxUpload())
    expect(nsis).toBeLessThan(store)
    expect(installers).toBeLessThan(store)
    expect(store).toBeLessThan(upload)
  })

  it('can never fail the release', () => {
    expect(appx()['continue-on-error']).toBe(true)
    expect(appx()['timeout-minutes']).toBeGreaterThan(0)
    expect(appxUpload()['continue-on-error']).toBe(true)
    // uploads only what a successful pass produced
    expect(appxUpload().if).toBe(
      `matrix.platform == 'win' && steps.${appx().id}.outcome == 'success'`,
    )
  })

  it('uploads only the .appx as faamoffice-store-appx, kept 30 days', () => {
    const upload = appxUpload()
    expect(upload.uses).toMatch(/^actions\/upload-artifact@/)
    expect(paths(upload)).toEqual(['apps/shell/release/store/*.appx'])
    expect(upload.with?.['retention-days']).toBe(30)
  })

  it('keeps the appx out of the installer artifact', () => {
    for (const path of paths(installersUpload())) {
      expect(path).not.toMatch(/\.appx$|\/store\//)
      expect(minimatch('apps/shell/release/store/FaamOffice-1.0.0-store.appx', path)).toBe(false)
    }
  })

  it('never puts the appx on the GitHub Release or in the feed', () => {
    const download = publish.steps.find((step) =>
      step.uses?.startsWith('actions/download-artifact'),
    )!
    const pattern = String(download.with?.pattern)
    expect(minimatch('faamoffice-store-appx', pattern)).toBe(false)
    for (const platform of ['mac', 'win', 'linux']) {
      expect(minimatch(`faamoffice-${platform}-0.12.0`, pattern)).toBe(true)
      expect(minimatch(`faamoffice-${platform}-0.12.0-beta.1`, pattern)).toBe(true)
    }
    // and should one ever be downloaded, the draft upload still skips it
    expect(publish.steps[stepIndex(/gh release create "\$TAG"/)]!.run).toContain("! -name '*.appx'")
  })
})
