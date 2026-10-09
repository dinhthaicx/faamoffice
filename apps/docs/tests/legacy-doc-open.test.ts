// @vitest-environment node
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, readdir, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { buildBlankDocx, parseDocx } from '@genoffice/docx-engine'
import {
  docxSavePath,
  MAX_LEGACY_DOC_BYTES,
  prepareLegacyDocForOpen,
} from '../src/main/legacy-doc-open'
import { atomicWriteFile } from '../src/main/atomic-write'

const fixture = fileURLToPath(
  new URL('../../../packages/file-parse/tests/fixtures/legacy-sample.doc', import.meta.url),
)
const directories: string[] = []
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'faamoffice-doc-import-test-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('legacy DOC opening', () => {
  it('opens a private editable DOCX, suggests a sibling, and preserves the DOC source', async () => {
    const directory = await scratch()
    const source = join(directory, 'Báo cáo.DOC')
    await copyFile(fixture, source)
    const original = await readFile(source)
    const imported = await prepareLegacyDocForOpen(source, join(directory, 'imports'))
    expect(imported.suggestSaveAs).toBe(join(directory, 'Báo cáo.docx'))
    expect(imported.sourceHash).toBe(hash(original))
    expect(imported.openPath).not.toBe(imported.suggestSaveAs)
    const converted = await readFile(imported.openPath)
    const parsed = await parseDocx(converted)
    expect(
      parsed.blocks
        .map((block) =>
          'runs' in block ? (block.runs?.map((run) => run.text).join('') ?? '') : '',
        )
        .join('\n'),
    ).toContain('Legacy DOC body text')
    // Saving the imported package uses the DOCX suggestion. It cannot write the
    // binary source even when the user types the old extension in Save As.
    await atomicWriteFile(docxSavePath(source), converted)
    expect((await readFile(imported.suggestSaveAs)).subarray(0, 2).toString()).toBe('PK')
    expect(hash(await readFile(source))).toBe(hash(original))
  })

  it('keeps an already existing sibling untouched until the Save As flow chooses it', async () => {
    const directory = await scratch()
    const source = join(directory, 'report.doc')
    const target = join(directory, 'report.docx')
    await copyFile(fixture, source)
    await writeFile(target, 'existing sibling')
    await prepareLegacyDocForOpen(source, join(directory, 'imports'))
    expect(await readFile(target, 'utf8')).toBe('existing sibling')
  })

  it('opens OOXML with a .doc suffix in a separate DOCX backing copy', async () => {
    const directory = await scratch()
    const source = join(directory, 'misnamed.doc')
    const bytes = await buildBlankDocx()
    await writeFile(source, bytes)
    const imported = await prepareLegacyDocForOpen(source, join(directory, 'imports'))
    expect(await readFile(imported.openPath)).toEqual(Buffer.from(bytes))
    expect(imported.suggestSaveAs).toBe(join(directory, 'misnamed.docx'))
  })

  it('rejects invalid and oversized files before leaving any import copy', async () => {
    const directory = await scratch()
    const source = join(directory, 'broken.doc')
    await writeFile(source, 'not a Word file')
    await expect(prepareLegacyDocForOpen(source, join(directory, 'imports'))).rejects.toThrow()
    await truncate(source, MAX_LEGACY_DOC_BYTES + 1)
    await expect(
      prepareLegacyDocForOpen(source, join(directory, 'imports')),
    ).rejects.toBeInstanceOf(RangeError)
    expect(await readdir(directory)).toEqual(['broken.doc'])
  })
})

describe('DOCX save extension', () => {
  it.each([
    ['/tmp/report.doc', '/tmp/report.docx'],
    ['/tmp/report.DOC', '/tmp/report.docx'],
    ['/tmp/report.docx', '/tmp/report.docx'],
    ['/tmp/report.DOCX', '/tmp/report.DOCX'],
    ['/tmp/report', '/tmp/report.docx'],
    ['/tmp/report.txt', '/tmp/report.txt.docx'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(docxSavePath(input)).toBe(expected)
  })
})
