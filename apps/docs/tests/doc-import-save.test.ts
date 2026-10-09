/** @vitest-environment jsdom */
import type { Editor } from '@tiptap/core'
import { buildBlankDocx, parseDocx, readSections } from '@genoffice/docx-engine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blocksToPmDoc, pmDocOptions, type PmNode } from '../src/renderer/editor/convert'
import { isDocDirty } from '../src/renderer/doc-dirty'
import type { DocState } from '../src/renderer/doc-state'
import {
  noteDocumentSwapped,
  save,
  writeRecoveryCopy,
  type FileActionContext,
} from '../src/renderer/file-actions'

const sourcePath = '/documents/report.doc'
const tempPath = '/temporary/import/report.docx'
const finalPath = '/documents/report.docx'

function gate<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function importedDocument() {
  const parsed = await parseDocx(await buildBlankDocx())
  const snapshot = () => ({ eq: () => true, content: { size: 10 } })
  const editorDoc = { current: snapshot() }
  let body = blocksToPmDoc(parsed.blocks, readSections(parsed), pmDocOptions(parsed))
  const editor = {
    getJSON: () => body,
    state: {
      get doc() {
        return editorDoc.current
      },
      selection: { from: 1 },
    },
    schema: { nodeFromJSON: () => editorDoc.current },
    storage: { listNumbering: {}, tabStops: {}, justifyShrink: {}, cjkPunctShrink: {} },
    view: { composing: false, dom: document.createElement('div') },
  } as unknown as Editor
  const state = {
    editor,
    doc: {
      parsed,
      filePath: tempPath,
      fileName: 'report.docx',
      hash: 'import-hash',
      suggestSaveAs: finalPath,
      importedFrom: sourcePath,
    } as DocState | null,
    dirtyRef: { current: true },
    saveInFlightRef: { current: false },
    saveIncompleteRef: { current: false },
    sections: readSections(parsed),
    sectionsDirty: [],
    pgNumDirtySections: [],
    sectionHfEdits: {},
    hfLinks: {},
    styleUpserts: {},
    hfVariantsDirty: [],
    trailingStartType: null,
    pgNumEdit: null,
    inkAnnotations: [],
    setStatus: vi.fn(),
    setDoc(update: DocState | null | ((prev: DocState | null) => DocState | null)) {
      state.doc = typeof update === 'function' ? update(state.doc) : update
    },
  }
  const noop = vi.fn()
  const ctx = new Proxy(state, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^(set|on)[A-Z]/.test(key) && !(key in target)) return noop
      if (typeof key === 'string' && key.endsWith('Dirty') && !(key in target)) return false
      return Reflect.get(target, key, receiver)
    },
  }) as unknown as FileActionContext
  return {
    ctx,
    edit(text: string) {
      body = structuredClone(body)
      const paragraph = body.content?.find((node) => node.type === 'docParagraph')
      if (!paragraph) throw new Error('blank document must contain an editable paragraph')
      paragraph.content = [{ type: 'text', text }] satisfies PmNode[]
      editorDoc.current = snapshot()
      ctx.dirtyRef.current = true
    },
  }
}

function fakeDesktop() {
  const original = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3])
  const disk = new Map<string, Uint8Array>([[sourcePath, original.slice()]])
  const api = {
    saveDocxAs: vi.fn(
      async (
        _name: string,
        bytes: ArrayBuffer,
        _source?: string | null,
      ): Promise<Awaited<ReturnType<typeof window.desktop.saveDocxAs>>> => {
        disk.set(finalPath, new Uint8Array(bytes).slice())
        return { ok: true, path: finalPath }
      },
    ),
    saveDocx: vi.fn(async (path: string, bytes: ArrayBuffer) => {
      disk.set(path, new Uint8Array(bytes).slice())
      return { ok: true }
    }),
    saveDocxTo: vi.fn(
      async (
        path: string,
        bytes: ArrayBuffer,
        _overwrite: boolean,
        _source?: string | null,
      ): Promise<Awaited<ReturnType<typeof window.desktop.saveDocxTo>>> => {
        disk.set(path, new Uint8Array(bytes).slice())
        return { ok: true, path }
      },
    ),
    saveDocxNew: vi.fn(),
    writeRecoveryCopy: vi.fn(async () => {}),
  }
  window.desktop = api as unknown as typeof window.desktop
  return { api, disk, original }
}

describe('legacy DOC import save lifecycle', () => {
  beforeEach(() => {
    noteDocumentSwapped()
    vi.stubGlobal('CSS', { escape: (value: string) => value })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('uses Save As on first Ctrl+S, adopts the final DOCX path and preserves the original DOC', async () => {
    const { ctx } = await importedDocument()
    const { api, disk, original } = fakeDesktop()
    const saved = await save(ctx, false)
    expect(saved, JSON.stringify(vi.mocked(ctx.setStatus).mock.calls)).toBe(true)
    expect(api.saveDocxAs).toHaveBeenCalledWith('report.docx', expect.any(ArrayBuffer), tempPath)
    expect(api.saveDocx).not.toHaveBeenCalled()
    expect(api.saveDocxNew).not.toHaveBeenCalled()
    expect(ctx.doc?.filePath).toBe(finalPath)
    expect(ctx.doc?.suggestSaveAs).toBeUndefined()
    expect(ctx.doc?.importedFrom).toBeUndefined()
    expect(isDocDirty(ctx)).toBe(false)
    expect((await parseDocx(disk.get(finalPath)!)).blocks.length).toBeGreaterThan(0)
    expect(disk.get(sourcePath)).toEqual(original)
    ctx.dirtyRef.current = true
    await expect(save(ctx, false, true)).resolves.toBe(true)
    expect(api.saveDocx).toHaveBeenCalledWith(finalPath, expect.any(ArrayBuffer), true)
    expect(api.saveDocxAs).toHaveBeenCalledTimes(1)
  })

  it('keeps an imported document unsaved during AutoSave and writes recovery only for the temporary DOCX', async () => {
    const { ctx } = await importedDocument()
    const { api, disk, original } = fakeDesktop()
    await expect(save(ctx, false, true)).resolves.toBe(false)
    await writeRecoveryCopy(ctx)
    expect(api.saveDocxAs).not.toHaveBeenCalled()
    expect(api.saveDocx).not.toHaveBeenCalled()
    expect(api.saveDocxNew).not.toHaveBeenCalled()
    expect(api.writeRecoveryCopy).toHaveBeenCalledWith(tempPath, expect.any(ArrayBuffer))
    expect(ctx.doc?.suggestSaveAs).toBe(finalPath)
    expect(isDocDirty(ctx)).toBe(true)
    expect(disk.get(sourcePath)).toEqual(original)
  })

  it('passes the backing import source to MCP output and keeps later saves on the chosen DOCX without a dialog', async () => {
    const { ctx, edit } = await importedDocument()
    const { api, disk, original } = fakeDesktop()
    const output = '/reports/mcp-output.docx'
    edit('Content saved through MCP')
    await expect(
      save(ctx, false, false, undefined, { path: output, overwrite: false }),
    ).resolves.toBe(true)
    expect(api.saveDocxTo).toHaveBeenCalledWith(output, expect.any(ArrayBuffer), false, tempPath)
    expect(api.saveDocxAs).not.toHaveBeenCalled()
    expect(api.saveDocxNew).not.toHaveBeenCalled()
    expect(ctx.doc?.filePath).toBe(output)
    expect(ctx.doc?.suggestSaveAs).toBeUndefined()
    expect(ctx.doc?.importedFrom).toBeUndefined()
    expect(isDocDirty(ctx)).toBe(false)
    const saved = await parseDocx(disk.get(output)!)
    expect(
      saved.blocks.map((block) => (block.runs ?? []).map((run) => run.text).join('')).join('\n'),
    ).toContain('Content saved through MCP')
    expect(disk.get(sourcePath)).toEqual(original)
    edit('Later normal save')
    await expect(save(ctx, false)).resolves.toBe(true)
    expect(api.saveDocx).toHaveBeenCalledWith(output, expect.any(ArrayBuffer), false)
    expect(api.saveDocxAs).not.toHaveBeenCalled()
  })

  it('shares a cancelled first Save As among overlapping callers and keeps close protection', async () => {
    const { ctx } = await importedDocument()
    const { api, disk, original } = fakeDesktop()
    const dialog = gate<{ ok: false }>()
    api.saveDocxAs.mockImplementationOnce(async () => dialog.promise)
    const first = save(ctx, false)
    const second = save(ctx, false)
    await vi.waitFor(() => expect(api.saveDocxAs).toHaveBeenCalledTimes(1))
    dialog.resolve({ ok: false })
    await expect(Promise.all([first, second])).resolves.toEqual([false, false])
    expect(api.saveDocxAs).toHaveBeenCalledTimes(1)
    expect(ctx.doc?.filePath).toBe(tempPath)
    expect(ctx.doc?.importedFrom).toBe(sourcePath)
    expect(isDocDirty(ctx)).toBe(true)
    expect(disk.get(sourcePath)).toEqual(original)
    await expect(save(ctx, false)).resolves.toBe(true)
    expect(api.saveDocxAs).toHaveBeenCalledTimes(2)
  })

  it('shares a successful first dialog and saves newer queued edits to the final path', async () => {
    const { ctx, edit } = await importedDocument()
    const { api, disk, original } = fakeDesktop()
    const dialog = gate<void>()
    api.saveDocxAs.mockImplementationOnce(async (_name, bytes) => {
      await dialog.promise
      disk.set(finalPath, new Uint8Array(bytes).slice())
      return { ok: true, path: finalPath }
    })
    const first = save(ctx, false)
    await vi.waitFor(() => expect(api.saveDocxAs).toHaveBeenCalledTimes(1))
    const queued = save(ctx, false)
    edit('A newer edit while Save As is open')
    dialog.resolve()
    await expect(Promise.all([first, queued])).resolves.toEqual([true, true])
    expect(api.saveDocxAs).toHaveBeenCalledTimes(1)
    expect(api.saveDocx).toHaveBeenCalledWith(finalPath, expect.any(ArrayBuffer), false)
    const saved = await parseDocx(disk.get(finalPath)!)
    expect(
      saved.blocks.map((block) => (block.runs ?? []).map((run) => run.text).join('')).join('\n'),
    ).toContain('A newer edit while Save As is open')
    expect(isDocDirty(ctx)).toBe(false)
    expect(disk.get(sourcePath)).toEqual(original)
  })

  it('does not adopt an old Save As result after a different document was opened', async () => {
    const { ctx } = await importedDocument()
    const { api } = fakeDesktop()
    const dialog = gate<void>()
    api.saveDocxAs.mockImplementationOnce(async () => {
      await dialog.promise
      return { ok: true, path: finalPath }
    })
    const pending = save(ctx, false)
    await vi.waitFor(() => expect(api.saveDocxAs).toHaveBeenCalledTimes(1))
    noteDocumentSwapped()
    const next = await importedDocument()
    dialog.resolve()
    await expect(pending).resolves.toBe(false)
    expect(ctx.doc?.filePath).toBe(tempPath)
    expect(ctx.doc?.suggestSaveAs).toBe(finalPath)
    await expect(save(next.ctx, false)).resolves.toBe(true)
    expect(api.saveDocxAs).toHaveBeenCalledTimes(2)
    expect(api.saveDocx).not.toHaveBeenCalled()
  })
})
