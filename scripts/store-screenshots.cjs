// Capture the actual Windows executable extracted from the Store release appx.
// No mocked UI, replacement window frame, marketing overlays or image resizing.
const { _electron } = require(
  require('node:path').join(process.env.CAPTURE_TOOLS, 'node_modules/playwright-core'),
)
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const os = require('node:os')

const exe = process.env.FAAM_CAPTURE_EXE
const output = resolve('apps/shell/release/store-screenshots')
const samples = join(output, 'samples')
const manifest = {
  capturedAt: new Date().toISOString(),
  platform: process.platform,
  os: os.version(),
  releaseRun: process.env.FAAM_CAPTURE_RELEASE_RUN,
  captureRun: process.env.GITHUB_RUN_ID,
  captureCommit: process.env.GITHUB_SHA,
  packageSha256: createHash('sha256')
    .update(readFileSync(process.env.FAAM_CAPTURE_APPX))
    .digest('hex'),
  method: 'Electron desktopCapturer: actual Windows application window',
  screenshots: [],
}
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
mkdirSync(samples, { recursive: true })

function cli(args) {
  const entry = join(exe, '..', 'resources', 'cli', 'faamoffice.cjs')
  console.log(
    execFileSync(exe, [entry, ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      timeout: 120_000,
    }),
  )
}

function createSamples(locale) {
  const vi = locale === 'vi'
  const report = vi
    ? '# Kế hoạch dự án\n\n## Mục tiêu\n\nXây dựng quy trình làm việc đơn giản, rõ ràng và dễ cộng tác.\n\n## Các giai đoạn\n\n| Giai đoạn | Công việc | Thời gian |\n| --- | --- | --- |\n| Khảo sát | Xác định nhu cầu | Tuần 1 |\n| Thiết kế | Chuẩn bị nội dung | Tuần 2 |\n| Triển khai | Kiểm tra và hoàn thiện | Tuần 3 |\n\n## Việc tiếp theo\n\n- Thống nhất phạm vi công việc\n- Phân công người phụ trách\n- Theo dõi tiến độ mỗi tuần\n\nTài liệu minh họa — không chứa dữ liệu cá nhân.\n'
    : '# Project plan\n\n## Objective\n\nBuild a simple, clear workflow that makes collaboration easier.\n\n## Milestones\n\n| Stage | Activity | Schedule |\n| --- | --- | --- |\n| Discovery | Identify requirements | Week 1 |\n| Design | Prepare content | Week 2 |\n| Delivery | Review and complete | Week 3 |\n\n## Next steps\n\n- Agree on the scope\n- Assign responsibilities\n- Review progress each week\n\nExample document — no personal data.\n'
  const md = join(samples, `${locale}-project.md`)
  const docx = join(samples, `${locale}-project.docx`)
  writeFileSync(md, report)
  // A synthetic OOXML fixture keeps capture independent of the CLI's jsdom
  // runtime. The unmodified release app opens and renders this real document.
  execFileSync('python', [join(__dirname, 'store-screenshot-docx.py'), md, docx])
  const json = join(samples, `${locale}-budget.json`)
  writeFileSync(
    json,
    JSON.stringify({
      sheets: [
        {
          name: vi ? 'Ngân sách' : 'Budget',
          rows: [
            [
              vi ? 'Hạng mục' : 'Category',
              vi ? 'Kế hoạch' : 'Planned',
              vi ? 'Thực tế' : 'Actual',
              vi ? 'Chênh lệch' : 'Difference',
            ],
            [vi ? 'Thiết kế' : 'Design', 1200, 1100, '=B2-C2'],
            [vi ? 'Nội dung' : 'Content', 900, 850, '=B3-C3'],
            [vi ? 'Vận hành' : 'Operations', 1500, 1400, '=B4-C4'],
            [vi ? 'Tổng cộng' : 'Total', '=SUM(B2:B4)', '=SUM(C2:C4)', '=B5-C5'],
          ],
        },
      ],
    }),
  )
  const xlsx = join(samples, `${locale}-budget.xlsx`)
  cli(['create', '--type', 'xlsx', '--from', json, '--header', '--out', xlsx, '--force'])
  const spec = join(samples, `${locale}-presentation.json`)
  writeFileSync(
    spec,
    JSON.stringify({
      pages: [
        {
          background: '#F1F5F9',
          elements: [
            {
              type: 'text',
              x: 90,
              y: 90,
              w: 1080,
              h: 110,
              paragraphs: [
                {
                  runs: [
                    {
                      text: vi ? 'Từ ý tưởng đến kết quả' : 'From ideas to results',
                      sizePt: 44,
                      bold: true,
                      color: '#0F172A',
                    },
                  ],
                },
              ],
            },
            {
              type: 'text',
              x: 95,
              y: 230,
              w: 1080,
              h: 100,
              paragraphs: [
                {
                  runs: [
                    {
                      text: vi ? 'Kế hoạch dự án · Tổng quan' : 'Project plan · Overview',
                      sizePt: 26,
                      color: '#475569',
                    },
                  ],
                },
              ],
            },
            {
              type: 'text',
              x: 95,
              y: 400,
              w: 1080,
              h: 170,
              paragraphs: [
                {
                  runs: [
                    {
                      text: vi
                        ? '01  Khảo sát\n02  Thiết kế\n03  Triển khai'
                        : '01  Discovery\n02  Design\n03  Delivery',
                      sizePt: 28,
                      color: '#0F172A',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  )
  const pptx = join(samples, `${locale}-presentation.pptx`)
  cli(['create', '--type', 'pptx', '--spec', spec, '--out', pptx, '--force'])
  return { docx, xlsx, pptx }
}

async function launch(locale, file) {
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...env } = process.env
  const app = await _electron.launch({
    executablePath: exe,
    args: ['--force-device-scale-factor=1', ...(file ? [file] : [])],
    env: { ...env, GENOFFICE_LANG: locale, FAAMOFFICE_ANNOUNCEMENTS: '0', FAAMOFFICE_UPDATES: '0' },
    timeout: 90_000,
  })
  await app.firstWindow()
  return app
}

async function close(app) {
  // The driver never edits an open document; quit directly to avoid native prompts.
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {})
  await app.close().catch(() => {})
}

async function capture(locale, kind, file) {
  const app = await launch(locale, file)
  try {
    await app.evaluate(({ BrowserWindow, nativeTheme }) => {
      nativeTheme.themeSource = 'light'
      const win = BrowserWindow.getAllWindows()[0]
      win.setBounds({ x: 0, y: 0, width: 1600, height: 1000 })
      win.show()
      win.focus()
    })
    if (file) {
      const domain = { docx: 'docs', xlsx: 'sheets', pptx: 'slides' }[kind]
      const deadline = Date.now() + 90_000
      let editor
      while (Date.now() < deadline && !editor) {
        editor = app.windows().find((page) => page.url().includes(`/modules/${domain}/`))
        if (!editor) await pause(250)
      }
      if (!editor) throw new Error(`Editor did not load: ${kind}`)
      await editor.locator('body').waitFor()
      await pause(12_000)
    } else {
      await app.firstWindow().then((page) => page.locator('body').waitFor())
      await pause(4_000)
    }
    const result = await app.evaluate(
      async ({ BrowserWindow, desktopCapturer, app: electronApp }) => {
        const win = BrowserWindow.getAllWindows()[0]
        const id = win.getMediaSourceId()
        const sources = await desktopCapturer.getSources({
          types: ['window'],
          thumbnailSize: { width: 1600, height: 1000 },
        })
        const source = sources.find((item) => item.id === id)
        if (!source || source.thumbnail.isEmpty()) throw new Error(`Missing window capture: ${id}`)
        return {
          png: source.thumbnail.toPNG().toString('base64'),
          size: source.thumbnail.getSize(),
          bounds: win.getBounds(),
          version: electronApp.getVersion(),
          title: source.name,
        }
      },
    )
    if (result.size.width < 1366 || result.size.height < 768)
      throw new Error(`Screenshot too small: ${JSON.stringify(result.size)}`)
    const png = Buffer.from(result.png, 'base64')
    const filename = `${locale}-${kind}.png`
    writeFileSync(join(output, filename), png)
    delete result.png
    manifest.screenshots.push({
      filename,
      locale,
      kind,
      ...result,
      sha256: createHash('sha256').update(png).digest('hex'),
    })
    writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    console.log(`Captured ${filename}: ${result.size.width}x${result.size.height}`)
  } finally {
    await close(app)
  }
}

async function main() {
  if (process.platform !== 'win32')
    throw new Error('Store screenshots require a real Windows runner')
  // The runner has no user profile to preserve. Discover the packaged app's
  // actual profile path rather than assuming the dev-only override works.
  const first = await launch('en')
  const profile = await first.evaluate(({ app }) => app.getPath('userData'))
  await close(first)
  mkdirSync(profile, { recursive: true })
  writeFileSync(
    join(profile, 'app-settings.json'),
    JSON.stringify({
      onboardingSeen: true,
      theme: 'light',
      documentTheme: 'light',
      analyticsEnabled: false,
    }),
  )
  for (const locale of ['vi', 'en']) {
    const files = createSamples(locale)
    await capture(locale, 'home')
    for (const [kind, file] of Object.entries(files)) await capture(locale, kind, file)
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
