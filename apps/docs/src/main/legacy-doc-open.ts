import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { convertLegacyDocToDocx } from '@genoffice/file-parse'
import { atomicWriteFile, looksLikeZip } from './atomic-write'

export const MAX_LEGACY_DOC_BYTES = 50 * 1024 * 1024

export interface LegacyDocImport {
  sourcePath: string
  sourceHash: string
  sourceSize: number
  openPath: string
  directory: string
  suggestSaveAs: string
  /** Set after the first successful save; retained metadata only cleans up the backing copy. */
  finalPath?: string
}

/** OOXML is always saved under its own extension, including a typed .doc name. */
export function docxSavePath(filePath: string): string {
  if (/\.docx$/i.test(filePath)) return filePath
  if (/\.doc$/i.test(filePath)) return filePath.replace(/\.doc$/i, '.docx')
  return `${filePath}.docx`
}

/**
 * Convert locally into a private backing copy. The binary source is never a
 * writable editor target; the first manual save chooses a separate DOCX file.
 */
export async function prepareLegacyDocForOpen(
  sourcePath: string,
  importRoot: string,
): Promise<LegacyDocImport> {
  const info = await stat(sourcePath)
  if (!info.isFile() || info.size > MAX_LEGACY_DOC_BYTES) {
    throw new RangeError('Legacy Word document exceeds the import limit')
  }
  const original = await readFile(sourcePath)
  if (original.length > MAX_LEGACY_DOC_BYTES) {
    throw new RangeError('Legacy Word document exceeds the import limit')
  }
  // Some producers put OOXML bytes under a .doc suffix. They still need a
  // separate DOCX save target, but do not need binary-format conversion.
  const converted = looksLikeZip(original) ? original : await convertLegacyDocToDocx(original)
  const bytes = Buffer.from(converted)
  if (!looksLikeZip(bytes)) throw new Error('Legacy Word conversion did not produce DOCX')
  await mkdir(importRoot, { recursive: true })
  const directory = await mkdtemp(join(importRoot, 'doc-'))
  try {
    const suggestSaveAs = docxSavePath(sourcePath)
    const openPath = join(directory, basename(suggestSaveAs))
    await atomicWriteFile(openPath, bytes)
    return {
      sourcePath,
      sourceHash: createHash('sha256').update(original).digest('hex'),
      sourceSize: original.length,
      openPath,
      directory,
      suggestSaveAs,
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}
