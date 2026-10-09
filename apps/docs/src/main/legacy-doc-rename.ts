import { existsSync, renameSync } from 'node:fs'
import { docxSavePath, type LegacyDocImport } from './legacy-doc-open'

/** Source renames affect a pending import, never a DOCX copy already saved elsewhere. */
export function legacyDocImportAfterRename(
  imported: LegacyDocImport,
  oldPath: string,
  newPath: string,
): LegacyDocImport | null {
  if (imported.finalPath || imported.sourcePath !== oldPath) return null
  return { ...imported, sourcePath: newPath, suggestSaveAs: docxSavePath(newPath) }
}

/** Move the recovery snapshot alone; the user already renamed the DOC source through the shell. */
export function moveLegacyDocRecovery(oldRecovery: string, newRecovery: string): void {
  if (oldRecovery !== newRecovery && existsSync(oldRecovery)) renameSync(oldRecovery, newRecovery)
}
