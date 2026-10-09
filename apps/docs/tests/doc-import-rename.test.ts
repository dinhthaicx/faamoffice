import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { LegacyDocImport } from '../src/main/legacy-doc-open'
import { legacyDocImportAfterRename, moveLegacyDocRecovery } from '../src/main/legacy-doc-rename'
import {
  documentAfterRename,
  documentRequiresSaveAs,
  type DocState,
} from '../src/renderer/doc-state'

const source = '/documents/old.doc'
const backing = '/temporary/import/old.docx'
const imported: LegacyDocImport = {
  sourcePath: source,
  sourceHash: 'original-doc-hash',
  sourceSize: 120,
  openPath: backing,
  directory: '/temporary/import',
  suggestSaveAs: '/documents/old.docx',
}
const documentState: DocState = {
  parsed: {} as DocState['parsed'],
  filePath: backing,
  fileName: 'old.docx',
  hash: 'backing-hash',
  importedFrom: source,
  suggestSaveAs: imported.suggestSaveAs,
}
const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('renaming a legacy DOC import source', () => {
  it('retargets the source and Save As folder without changing the editable backing copy', () => {
    const next = legacyDocImportAfterRename(imported, source, '/reports/new.DOC')!
    expect(next.sourcePath).toBe('/reports/new.DOC')
    expect(next.suggestSaveAs).toBe('/reports/new.docx')
    expect(next.openPath).toBe(backing)
    expect(next.sourceHash).toBe(imported.sourceHash)
    expect(imported.sourcePath).toBe(source)
    const ui = documentAfterRename(documentState, source, next.sourcePath)!
    expect(ui.filePath).toBe(backing)
    expect(ui.importedFrom).toBe(next.sourcePath)
    expect(ui.suggestSaveAs).toBe(next.suggestSaveAs)
    expect(ui.fileName).toBe('new.docx')
    expect(documentRequiresSaveAs(ui)).toBe(true)
  })

  it('keeps Windows path separators and the original DOCX backing path on a folder move', () => {
    const state = { ...documentState, importedFrom: 'C:\\Docs\\Old.DOC' }
    const ui = documentAfterRename(state, state.importedFrom, 'D:\\Reports\\New.DOC')!
    expect(ui.importedFrom).toBe('D:\\Reports\\New.DOC')
    expect(ui.suggestSaveAs).toBe('D:\\Reports\\New.docx')
    expect(ui.fileName).toBe('New.docx')
    expect(ui.filePath).toBe(backing)
  })

  it('leaves a finalized DOCX independent of any later source rename', () => {
    expect(
      legacyDocImportAfterRename(
        { ...imported, finalPath: '/saved/copy.docx' },
        source,
        '/moved/source.doc',
      ),
    ).toBeNull()
    const saved = {
      ...documentState,
      filePath: '/saved/copy.docx',
      importedFrom: undefined,
      suggestSaveAs: undefined,
    }
    expect(documentAfterRename(saved, source, '/moved/source.doc')).toBe(saved)
    expect(legacyDocImportAfterRename(imported, '/other.doc', '/moved/source.doc')).toBeNull()
    const normalRename = documentAfterRename(saved, '/saved/copy.docx', '/saved/renamed.docx')!
    expect(normalRename.filePath).toBe('/saved/renamed.docx')
    expect(normalRename.fileName).toBe('renamed.docx')
  })

  it('moves the recovery snapshot to the renamed source key without writing the source or backing DOCX', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'faamoffice-doc-rename-'))
    directories.push(directory)
    const original = join(directory, 'old.doc')
    const renamedSource = join(directory, 'new.doc')
    const temporary = join(directory, 'backing.docx')
    const oldRecovery = join(directory, 'old-key.docx')
    const newRecovery = join(directory, 'new-key.docx')
    await writeFile(original, 'binary DOC source')
    await writeFile(temporary, 'converted DOCX backing')
    await writeFile(oldRecovery, 'unsaved editor changes')
    // The shell has already completed the user's source-file rename.
    await rename(original, renamedSource)
    moveLegacyDocRecovery(oldRecovery, newRecovery)
    expect(await readFile(newRecovery, 'utf8')).toBe('unsaved editor changes')
    await expect(readFile(oldRecovery)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(renamedSource, 'utf8')).toBe('binary DOC source')
    expect(await readFile(temporary, 'utf8')).toBe('converted DOCX backing')
    // A second notification has no snapshot left to move and must be harmless.
    expect(() => moveLegacyDocRecovery(oldRecovery, newRecovery)).not.toThrow()
    expect(() => moveLegacyDocRecovery(newRecovery, newRecovery)).not.toThrow()
  })
})
