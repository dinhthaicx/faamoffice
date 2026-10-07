import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The update-feed rules of .github/workflows/release.yml: only tag builds bake
 * the feed, no token reaches electron-builder, the feed files are uploaded,
 * and the publish job keeps the release a draft until its feed is complete
 * and moves Latest one tag at a time. scripts/release-feed.cjs itself is
 * release-feed.test.ts's subject.
 */

// js-yaml as electron-updater (a shell dependency) resolves it
const require = createRequire(import.meta.url)
const { load } = createRequire(require.resolve('electron-updater'))('js-yaml') as {
  load: (text: string) => unknown
}

interface Step {
  name?: string
  if?: string
  run?: string
  uses?: string
  env?: Record<string, string>
  with?: Record<string, string>
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
    const paths = (upload?.with?.path ?? '').split('\n').map((line) => line.trim())
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
