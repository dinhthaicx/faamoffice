import { test, expect } from '@playwright/test'
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl } from './helpers'

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

test('legacy DOC opens editable; cancelled Save As keeps edits; first save creates DOCX', async () => {
  test.setTimeout(120_000)
  const directory = await mkdtemp(join(tmpdir(), 'faamoffice-legacy-doc-e2e-'))
  const source = join(directory, 'legacy.doc')
  const target = join(directory, 'legacy.docx')
  await copyFile(resolve('packages/file-parse/tests/fixtures/legacy-sample.doc'), source)
  const originalHash = sha256(await readFile(source))
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'docs-legacy-doc',
    openFile: source,
  })
  try {
    const editor = await waitForPageWithUrl(launched.app, '://docs/')
    const page = editor.locator('.doc-page[contenteditable="true"]')
    await expect(page).toContainText('Legacy Report')
    await expect(page).toContainText('Legacy DOC body text')
    await launched.app.evaluate(({ dialog }, expected) => {
      const state = { calls: 0, expected }
      ;(globalThis as unknown as { legacySaveState: typeof state }).legacySaveState = state
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as { defaultPath?: string }
        if (options.defaultPath !== state.expected) {
          throw new Error(`Unexpected DOCX save suggestion: ${options.defaultPath}`)
        }
        state.calls++
        return state.calls === 1
          ? { canceled: true }
          : // Type the old suffix deliberately: the application must normalize
            // it and preserve the original binary file.
            { canceled: false, filePath: state.expected.replace(/\.docx$/, '.doc') }
      }) as typeof dialog.showSaveDialog
    }, target)

    const requestSave = () =>
      launched.app.evaluate(({ webContents }) => {
        webContents
          .getAllWebContents()
          .find((wc) => wc.getURL().includes('://docs/'))
          ?.send('menu:command', 'save')
      })
    await requestSave()
    await expect
      .poll(() =>
        launched.app.evaluate(
          () =>
            (globalThis as unknown as { legacySaveState: { calls: number } }).legacySaveState.calls,
        ),
      )
      .toBe(1)
    await expect(stat(target)).rejects.toThrow()
    expect(sha256(await readFile(source))).toBe(originalHash)

    await page.locator('p').last().click()
    await editor.keyboard.press('ControlOrMeta+End')
    await editor.keyboard.type(' Edited in FaamOffice.')
    await expect(page).toContainText('Edited in FaamOffice.')
    await requestSave()
    await expect
      .poll(async () => (await stat(target).catch(() => ({ size: 0 }))).size)
      .toBeGreaterThan(0)
    const saved = await readFile(target)
    const zip = await JSZip.loadAsync(saved)
    expect(await zip.file('word/document.xml')!.async('string')).toContain('Edited in FaamOffice.')
    expect(sha256(await readFile(source))).toBe(originalHash)

    // Further saves use the new DOCX path and no longer open another dialog.
    await page.locator('p').last().click()
    await editor.keyboard.press('ControlOrMeta+End')
    await editor.keyboard.type(' Second save.')
    await requestSave()
    await expect
      .poll(async () => {
        const current = await JSZip.loadAsync(await readFile(target))
        return current.file('word/document.xml')!.async('string')
      })
      .toContain('Second save.')
    expect(
      await launched.app.evaluate(
        () =>
          (globalThis as unknown as { legacySaveState: { calls: number } }).legacySaveState.calls,
      ),
    ).toBe(2)
    expect(sha256(await readFile(source))).toBe(originalHash)
    await editor.screenshot({ path: test.info().outputPath('doc-opened-saved-docx.png') })
  } finally {
    await closeAndSaveVideo(launched, 'docs-legacy-doc')
    await rm(directory, { recursive: true, force: true })
  }
})
