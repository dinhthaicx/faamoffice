import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import JSZip from 'jszip'
import type { DesktopApi } from '../apps/docs/src/shared/ipc'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl, type LaunchedApp } from './helpers'

interface DocsWindow {
  desktop: DesktopApi
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const marker = ' Recovery retained after crash.'

async function openBlankDocs(launched: LaunchedApp) {
  await launched.page.locator('.quick-card').first().click()
  const editor = await waitForPageWithUrl(launched.app, '://docs/')
  await expect(editor.locator('.doc-page[contenteditable="true"]').first()).toBeVisible()
  return editor
}

/** Only terminate this test's isolated Electron process, bypassing discard/teardown. */
async function crashTestApp(launched: LaunchedApp): Promise<void> {
  const child = launched.app.process()
  const exited = once(child, 'exit')
  if (!child.kill('SIGKILL')) throw new Error('Could not terminate the isolated test process')
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      exited,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Test process did not exit after crash')),
          10_000,
        )
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
  await launched.app.close().catch(() => {})
}

test('legacy DOC recovery survives a crash and restores into a fresh DOCX import', async () => {
  test.setTimeout(120_000)
  const directory = await mkdtemp(join(tmpdir(), 'faamoffice-legacy-recovery-e2e-'))
  const userDataDir = join(directory, 'user-data')
  const source = join(directory, 'legacy.doc')
  const target = join(directory, 'recovered.docx')
  const importDirectories = new Set<string>()
  let first: LaunchedApp | undefined
  let second: LaunchedApp | undefined
  await mkdir(userDataDir)
  await copyFile(resolve('packages/file-parse/tests/fixtures/legacy-sample.doc'), source)
  const originalHash = sha256(await readFile(source))
  try {
    first = await launchShell({
      onboardingSeen: true,
      userDataDir,
      videoDir: 'docs-legacy-recovery-before-crash',
    })
    const firstEditor = await openBlankDocs(first)
    // Read the real main-process conversion through its one-shot byte handoff.
    const opened = await firstEditor.evaluate(async (path) => {
      const result = await (window as unknown as DocsWindow).desktop.openDocxPath(path)
      if (!result || !('dataUrl' in result)) throw new Error('Legacy DOC did not open')
      const response = await fetch(result.dataUrl)
      if (!response.ok) throw new Error('Could not consume the DOCX byte handoff')
      return { result, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) }
    }, source)
    expect(opened.result.importedFrom).toBe(source)
    expect(opened.result.path).not.toBe(source)
    importDirectories.add(dirname(opened.result.path))
    const zip = await JSZip.loadAsync(Uint8Array.from(opened.bytes))
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('Second paragraph from Word 97-2003.')
    zip.file(
      'word/document.xml',
      xml.replace(
        'Second paragraph from Word 97-2003.',
        `Second paragraph from Word 97-2003.${marker}`,
      ),
    )
    const edited = await zip.generateAsync({ type: 'uint8array' })
    expect(
      await firstEditor.evaluate(
        async ({ path, bytes }) =>
          (window as unknown as DocsWindow).desktop.writeRecoveryCopy(
            path,
            Uint8Array.from(bytes).buffer,
          ),
        { path: opened.result.path, bytes: Array.from(edited) },
      ),
    ).toEqual({ ok: true })

    const recoveryName = `${createHash('sha1').update(source).digest('hex').slice(0, 16)}.docx`
    const recoveryDirectory = join(userDataDir, 'docs-autosave')
    const recoveryPath = join(recoveryDirectory, recoveryName)
    expect((await readdir(recoveryDirectory)).filter((name) => name.endsWith('.docx'))).toEqual([
      recoveryName,
    ])
    const persisted = await JSZip.loadAsync(await readFile(recoveryPath))
    expect(await persisted.file('word/document.xml')!.async('string')).toContain(marker)
    expect(sha256(await readFile(source))).toBe(originalHash)

    // A graceful close would intentionally delete the recovery snapshot.
    await crashTestApp(first)
    first = undefined
    expect((await stat(recoveryPath)).size).toBeGreaterThan(0)

    // Open without argv first, so Restore is stubbed before the DOC is imported.
    second = await launchShell({
      onboardingSeen: true,
      userDataDir,
      videoDir: 'docs-legacy-recovery-restored',
    })
    await second.app.evaluate(({ dialog }) => {
      const state = { calls: 0 }
      ;(globalThis as unknown as { legacyRestoreState: typeof state }).legacyRestoreState = state
      dialog.showMessageBox = (async () => {
        state.calls++
        return { response: 0, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
    })
    const restoredEditor = await openBlankDocs(second)
    const restored = await restoredEditor.evaluate(async (path) => {
      const result = await (window as unknown as DocsWindow).desktop.openDocxPath(path)
      if (!result || !('dataUrl' in result)) throw new Error('Legacy DOC did not reopen')
      return result
    }, source)
    expect(restored.recovered).toBe(true)
    expect(restored.importedFrom).toBe(source)
    expect(restored.path).not.toBe(opened.result.path)
    importDirectories.add(dirname(restored.path))
    expect(
      await second.app.evaluate(
        () =>
          (globalThis as unknown as { legacyRestoreState: { calls: number } }).legacyRestoreState
            .calls,
      ),
    ).toBe(1)
    // The renderer consumes the restored one-shot URL and displays the edited document.
    await second.app.evaluate(({ webContents }, result) => {
      const docs = webContents.getAllWebContents().find((wc) => wc.getURL().includes('://docs/'))
      if (!docs) throw new Error('Docs renderer missing')
      docs.send('docs:opened', result)
    }, restored)
    const page = restoredEditor.locator('.doc-page[contenteditable="true"]')
    await expect(page).toContainText('Legacy Report')
    await expect(page).toContainText(marker)
    expect(sha256(await readFile(source))).toBe(originalHash)

    await second.app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath,
      })) as typeof dialog.showSaveDialog
    }, target)
    await second.app.evaluate(({ webContents }) => {
      webContents
        .getAllWebContents()
        .find((wc) => wc.getURL().includes('://docs/'))
        ?.send('menu:command', 'save')
    })
    await expect
      .poll(async () => (await stat(target).catch(() => ({ size: 0 }))).size)
      .toBeGreaterThan(0)
    const saved = await JSZip.loadAsync(await readFile(target))
    expect(await saved.file('word/document.xml')!.async('string')).toContain(marker)
    await expect.poll(async () => (await stat(recoveryPath).catch(() => null)) !== null).toBe(false)
    // A delayed tick from the old backing path cannot recreate source recovery after Save As.
    expect(
      await restoredEditor.evaluate(
        async ({ path, bytes }) =>
          (window as unknown as DocsWindow).desktop.writeRecoveryCopy(
            path,
            Uint8Array.from(bytes).buffer,
          ),
        { path: restored.path, bytes: Array.from(edited) },
      ),
    ).toEqual({ ok: false })
    await expect(stat(recoveryPath)).rejects.toThrow()
    expect(sha256(await readFile(source))).toBe(originalHash)
    await restoredEditor.screenshot({ path: test.info().outputPath('legacy-doc-restored.png') })
  } finally {
    if (second) await closeAndSaveVideo(second, 'docs-legacy-recovery-restored').catch(() => {})
    if (first) await closeAndSaveVideo(first, 'docs-legacy-recovery-before-crash').catch(() => {})
    for (const importDirectory of importDirectories) {
      await rm(importDirectory, { recursive: true, force: true })
    }
    await rm(directory, { recursive: true, force: true })
  }
})
