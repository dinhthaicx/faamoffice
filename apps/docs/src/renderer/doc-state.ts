/**
 * Shared document-state types and header/footer helpers used by App.tsx and
 * the extracted action modules (file-actions, review-actions, …).
 */
import type { HeaderFooter, HfPartInfo, ParsedDocFull } from '@genoffice/docx-engine'

/** first-page / even-page header & footer variants */
export type HfVariantKey = 'headerFirst' | 'footerFirst' | 'headerEven' | 'footerEven'
export type HfVariantsState = Record<HfVariantKey, HeaderFooter | null>
export type HfView = 'default' | 'first' | 'even'

export const EMPTY_HF_VARIANTS: HfVariantsState = {
  headerFirst: null,
  footerFirst: null,
  headerEven: null,
  footerEven: null,
}

export interface DocState {
  parsed: ParsedDocFull
  /** null until a new document is saved for the first time */
  filePath: string | null
  fileName: string
  hash: string
  /** created from the built-in blank template (its numbering ids are known) */
  isBlank?: boolean
  /** desired open password is set for the next save; toggled via Review > Protect */
  encrypted?: boolean
  /** a converted legacy DOC still needs a user-chosen DOCX destination */
  suggestSaveAs?: string
  /** read-only original DOC; filePath points at the editable temporary DOCX */
  importedFrom?: string
}

export function documentRequiresSaveAs(
  doc: { suggestSaveAs?: string } | null | undefined,
): boolean {
  return !!doc?.suggestSaveAs
}

/** Recovery and imported copies have not reached their final save destination yet. */
export function openedFileStartsDirty(result: {
  recovered?: boolean
  suggestSaveAs?: string
}): boolean {
  return result.recovered === true || documentRequiresSaveAs(result)
}

/** A DOC source moves independently of its editable temporary DOCX. */
export function documentAfterRename(
  doc: DocState | null,
  oldPath: string,
  newPath: string,
): DocState | null {
  if (!doc) return doc
  if (documentRequiresSaveAs(doc) && doc.importedFrom === oldPath) {
    const suggestSaveAs = newPath.replace(/\.doc$/i, '.docx')
    return {
      ...doc,
      importedFrom: newPath,
      suggestSaveAs,
      fileName: suggestSaveAs.split(/[\\/]/).pop() ?? doc.fileName,
    }
  }
  return doc.filePath === oldPath
    ? { ...doc, filePath: newPath, fileName: newPath.split(/[\\/]/).pop() ?? doc.fileName }
    : doc
}

/** Pending numbering definitions to append (saved via SaveOptions.numbering) */
export interface PendingNumbering {
  newDefs: Array<{
    numId: string
    kind: 'bullet' | 'ordered'
    levels?: import('@genoffice/docx-engine').CustomNumberingLevel[]
  }>
  restartNums: Array<{
    numId: string
    abstractNumId: string
    startOverrides: Record<number, number>
  }>
  /** one w:lvl of an existing abstractNum rewritten (Adjust List Indents on a parsed list) */
  levelEdits: Array<{
    abstractNumId: string
    ilvl: number
    level: import('@genoffice/docx-engine').CustomNumberingLevel
  }>
  /** picture bullets (w:numPicBullet) referenced by pending levels */
  picBullets: Array<{ id: number; base64: string; mime: 'image/png' | 'image/jpeg' | 'image/gif' }>
}

export const EMPTY_PENDING_NUMBERING: PendingNumbering = {
  newDefs: [],
  restartNums: [],
  levelEdits: [],
  picBullets: [],
}

export function pendingNumberingDirty(p: PendingNumbering): boolean {
  return (
    p.newDefs.length > 0 ||
    p.restartNums.length > 0 ||
    p.levelEdits.length > 0 ||
    p.picBullets.length > 0
  )
}

export function hfFromPart(part: HfPartInfo | null | undefined): HeaderFooter | null {
  // image-only parts (logo headers/footers) are not empty — the canvas path
  // (hfHasVisibleContent) already counts images; keep both checks aligned
  if (
    !part ||
    (!part.text && !part.hasPageNumber && part.paras.length === 0 && !part.images?.length)
  )
    return null
  return {
    text: part.text,
    pageNumber: part.hasPageNumber,
    paras: part.paras.length > 0 ? part.paras : undefined,
  }
}

/**
 * Variant a canvas edge header/footer area shows (it follows its page, as in Word):
 * the header area sits on page 1 (titlePg -> first-page variant, blank when
 * that part is absent — Word semantics), the footer area on the last page.
 */
export function restingHfAreaVariant(
  kind: 'header' | 'footer',
  opts: { titlePg: boolean; evenOddHf: boolean; pageCount: number; lastPageNo?: number },
): HfView {
  if (kind === 'header') return opts.titlePg ? 'first' : 'default'
  if (opts.titlePg && opts.pageCount <= 1) return 'first'
  if (opts.evenOddHf && (opts.lastPageNo ?? opts.pageCount) % 2 === 0) return 'even'
  return 'default'
}

export function hfVariantsFromParsed(parsed: ParsedDocFull): HfVariantsState {
  return {
    headerFirst: hfFromPart(parsed.headerFirst),
    footerFirst: hfFromPart(parsed.footerFirst),
    headerEven: hfFromPart(parsed.headerEven),
    footerEven: hfFromPart(parsed.footerEven),
  }
}
