import JSZip from 'jszip'
import { buildBlankDocx } from '@genoffice/docx-engine'
import {
  readLegacyDocModel,
  type LegacyDocBorder,
  type LegacyDocImage,
  type LegacyDocModel,
  type LegacyDocPage,
  type LegacyDocParagraph,
  type LegacyDocRun,
} from './legacy-doc-model'

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const DOC_NS =
  `xmlns:w="${W_NS}" xmlns:r="${R_NS}" ` +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'
const MAX_IMAGE_BYTES = 16 * 1024 * 1024
const MAX_MEDIA_BYTES = 64 * 1024 * 1024

/** A legacy file could not be read; callers should localize this error. */
export class LegacyDocImportError extends Error {
  readonly code = 'legacy_doc_unsupported'

  constructor() {
    super(
      'Cannot import this legacy Word document: it is unsupported, encrypted, corrupt or too large.',
    )
    this.name = 'LegacyDocImportError'
  }
}

/**
 * Import Word 97–2003 offline as editable DOCX, without macros or HTML.
 * Formatting is retained where the binary reader recovers it. Section breaks,
 * floating-shape layout, and unavailable list definitions cannot be recreated.
 * Unmapped note/comment/textbox text is retained at the end of the document.
 */
export async function convertLegacyDocToDocx(bytes: Uint8Array): Promise<Uint8Array> {
  const model = readLegacyDocModel(bytes)
  if (!model) throw new LegacyDocImportError()
  return legacyDocModelToDocx(model)
}

function cleanXml(value: string): string {
  // XML 1.0 cannot contain NUL, unpaired surrogates or most ASCII controls.
  // eslint-disable-next-line no-control-regex -- This is the XML 1.0 character allowlist.
  return value.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
}

function escapeXml(value: string): string {
  return cleanXml(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[char]!,
  )
}

function number(value: number | undefined | null, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? Math.round(value)
    : undefined
}

function color(value: number | null | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffffff) return
  return [value & 255, (value >> 8) & 255, (value >> 16) & 255]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

const HIGHLIGHTS: Record<string, string> = {
  '000000': 'black',
  '0000FF': 'blue',
  '00FFFF': 'cyan',
  '00FF00': 'green',
  FF00FF: 'magenta',
  FF0000: 'red',
  FFFF00: 'yellow',
  FFFFFF: 'white',
  '000080': 'darkBlue',
  '008080': 'darkCyan',
  '008000': 'darkGreen',
  '800080': 'darkMagenta',
  '800000': 'darkRed',
  '808000': 'darkYellow',
  '808080': 'darkGray',
  C0C0C0: 'lightGray',
}

function orderedProperties(properties: string[], order: string[]): string {
  // CT_RPr and CT_PPr have ordered child sequences in the OOXML schema.
  return properties
    .sort(
      (a, b) =>
        order.indexOf(/^<w:(\w+)/.exec(a)?.[1] ?? '') -
        order.indexOf(/^<w:(\w+)/.exec(b)?.[1] ?? ''),
    )
    .join('')
}

function runProperties(run: LegacyDocRun): string {
  const properties: string[] = []
  for (const [key, tag] of [
    ['b', 'b'],
    ['i', 'i'],
    ['strike', 'strike'],
    ['dstrike', 'dstrike'],
    ['smallCaps', 'smallCaps'],
    ['caps', 'caps'],
    ['hidden', 'vanish'],
  ] as const) {
    if (run[key] !== undefined) {
      properties.push(`<w:${tag} w:val="${run[key] ? '1' : '0'}"/>`)
      if (tag === 'b' || tag === 'i')
        properties.push(`<w:${tag}Cs w:val="${run[key] ? '1' : '0'}"/>`)
    }
  }
  if (run.u !== undefined) {
    const styles = { double: 'double', dotted: 'dotted', dashed: 'dash', wavy: 'wave' }
    properties.push(
      `<w:u w:val="${run.u ? (run.uStyle ? styles[run.uStyle] : 'single') : 'none'}"/>`,
    )
  }
  if (run.font) {
    const font = escapeXml(run.font)
    properties.push(
      `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>`,
    )
  }
  const size = run.size == null ? undefined : number(run.size * 2, 1, 3276)
  if (size !== undefined) properties.push(`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`)
  const foreground = color(run.color)
  if (foreground) properties.push(`<w:color w:val="${foreground}"/>`)
  const highlight = color(run.highlight)
  if (highlight)
    properties.push(
      HIGHLIGHTS[highlight]
        ? `<w:highlight w:val="${HIGHLIGHTS[highlight]}"/>`
        : `<w:shd w:val="clear" w:color="auto" w:fill="${highlight}"/>`,
    )
  const spacing = run.spacing == null ? undefined : number(run.spacing * 20, -31680, 31680)
  if (spacing !== undefined) properties.push(`<w:spacing w:val="${spacing}"/>`)
  const position = run.position == null ? undefined : number(run.position * 2, -3168, 3168)
  if (position !== undefined) properties.push(`<w:position w:val="${position}"/>`)
  if (run.va)
    properties.push(`<w:vertAlign w:val="${run.va === 'super' ? 'superscript' : 'subscript'}"/>`)
  return properties.length
    ? `<w:rPr>${orderedProperties(properties, [
        'rFonts',
        'b',
        'bCs',
        'i',
        'iCs',
        'caps',
        'smallCaps',
        'strike',
        'dstrike',
        'vanish',
        'color',
        'spacing',
        'position',
        'sz',
        'highlight',
        'u',
        'shd',
        'vertAlign',
      ])}</w:rPr>`
    : ''
}

function textXml(text: string): string {
  return cleanXml(text)
    .replace(/\r\n?/g, '\n')
    .split(/([\t\n])/)
    .map((piece) =>
      piece === '\t'
        ? '<w:tab/>'
        : piece === '\n'
          ? '<w:br/>'
          : piece
            ? `<w:t xml:space="preserve">${escapeXml(piece)}</w:t>`
            : '',
    )
    .join('')
}

function borderXml(side: string, border: LegacyDocBorder): string {
  const styles: Record<number, string> = {
    0: 'nil',
    1: 'single',
    2: 'thick',
    3: 'double',
    5: 'single',
    6: 'dotted',
    7: 'dashed',
    8: 'dotDash',
    9: 'dotDotDash',
    10: 'triple',
    11: 'thinThickSmallGap',
    12: 'thickThinSmallGap',
    13: 'thinThickThinSmallGap',
    14: 'thinThickMediumGap',
    15: 'thickThinMediumGap',
    16: 'thinThickThinMediumGap',
    17: 'thinThickLargeGap',
    18: 'thickThinLargeGap',
    19: 'thinThickThinLargeGap',
    20: 'wave',
    21: 'doubleWave',
    22: 'dashSmallGap',
    23: 'dashDotStroked',
    24: 'threeDEmboss',
    25: 'threeDEngrave',
    26: 'outset',
    27: 'inset',
  }
  const style = styles[border.type]
  if (!style) return ''
  const width = border.type === 5 ? 2 : (number(border.width * 8, 0, 96) ?? 4)
  return `<w:${side} w:val="${style}" w:sz="${width}" w:color="${color(border.color) ?? 'auto'}"/>`
}

function paragraphProperties(paragraph: LegacyDocParagraph): string {
  const pp = paragraph.pp ?? {}
  const properties: string[] = []
  const align = ['left', 'center', 'right', 'both'][paragraph.align]
  if (align) properties.push(`<w:jc w:val="${align}"/>`)
  if (pp.keepNext) properties.push('<w:keepNext/>')
  if (pp.keepLines) properties.push('<w:keepLines/>')
  if (pp.pageBreak) properties.push('<w:pageBreakBefore/>')
  const left = number(pp.indL, -31680, 31680)
  const right = number(pp.indR, -31680, 31680)
  const first = number(pp.ind1, -31680, 31680)
  const indents = [
    left !== undefined ? `w:left="${left}"` : '',
    right !== undefined ? `w:right="${right}"` : '',
    first !== undefined ? (first < 0 ? `w:hanging="${-first}"` : `w:firstLine="${first}"`) : '',
  ].filter(Boolean)
  if (indents.length) properties.push(`<w:ind ${indents.join(' ')}/>`)
  // The binary reader omits zero values. Override the blank template's 6pt
  // after / 1.15 line defaults instead of adding spacing absent in the source.
  const before = number(pp.spB, 0, 31680) ?? 0
  const after = number(pp.spA, 0, 31680) ?? 0
  const line = number(pp.line, -31680, 31680)
  const rule = line && pp.lineMult !== 1 ? (line < 0 ? 'exact' : 'atLeast') : 'auto'
  properties.push(
    `<w:spacing w:before="${before}" w:after="${after}" w:line="${line ? Math.abs(line) : 240}" w:lineRule="${rule}"/>`,
  )
  if (pp.tabs?.length) {
    const tabs = pp.tabs.flatMap((tab) => {
      const pos = number(tab.pos, -31680, 31680)
      if (pos === undefined) return []
      const align = ['left', 'center', 'right', 'decimal', 'bar'].includes(tab.align)
        ? tab.align
        : 'left'
      const leader = ['none', 'dot', 'hyphen', 'underscore', 'heavy', 'middot'].includes(tab.leader)
        ? tab.leader
        : 'none'
      return `<w:tab w:val="${align}" w:leader="${leader === 'middot' ? 'middleDot' : leader}" w:pos="${pos}"/>`
    })
    if (tabs.length) properties.push(`<w:tabs>${tabs.join('')}</w:tabs>`)
  }
  const fill = color(pp.shd)
  if (fill) properties.push(`<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`)
  if (pp.borders) {
    const borders = (['top', 'left', 'bottom', 'right'] as const)
      .map((side) => (pp.borders![side] ? borderXml(side, pp.borders![side]!) : ''))
      .join('')
    if (borders) properties.push(`<w:pBdr>${borders}</w:pBdr>`)
  }
  return `<w:pPr>${orderedProperties(properties, [
    'keepNext',
    'keepLines',
    'pageBreakBefore',
    'pBdr',
    'shd',
    'tabs',
    'spacing',
    'ind',
    'jc',
  ])}</w:pPr>`
}

interface PartContext {
  relationships: string[]
  nextRelationship: number
}

function relationship(
  context: PartContext,
  type: string,
  target: string,
  external = false,
): string {
  const id = `rId${context.nextRelationship++}`
  context.relationships.push(
    `<Relationship Id="${id}" Type="${R_NS}/${type}" Target="${escapeXml(target)}"${external ? ' TargetMode="External"' : ''}/>`,
  )
  return id
}

function relsXml(context: PartContext): string {
  return `${XML_DECL}<Relationships xmlns="${PKG_REL_NS}">${context.relationships.join('')}</Relationships>`
}

function safeLink(raw: string | undefined): string | undefined {
  // eslint-disable-next-line no-control-regex -- Reject control characters before URL parsing normalizes them.
  if (!raw || /[\u0000-\u0020\u007f]/.test(raw)) return
  try {
    const url = new URL(raw)
    if (['https:', 'http:', 'mailto:'].includes(url.protocol)) return raw
  } catch {
    /* Retain the displayed text when a source link is unsafe. */
  }
}

function rasterBytes(image: LegacyDocImage): Uint8Array | undefined {
  if (
    !Array.isArray(image.bytes) ||
    image.bytes.length < 4 ||
    image.bytes.length > MAX_IMAGE_BYTES ||
    image.bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  )
    return
  const bytes = Uint8Array.from(image.bytes)
  if (
    image.mime === 'image/png' &&
    bytes.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
  )
    return bytes
  if (image.mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return bytes
}

function rasterSize(bytes: Uint8Array, mime: LegacyDocImage['mime']): [number, number] | undefined {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (mime === 'image/png' && bytes.length >= 24) {
    const w = dv.getUint32(16),
      h = dv.getUint32(20)
    if (w > 0 && h > 0 && w <= 100000 && h <= 100000) return [w, h]
  }
  if (mime === 'image/jpeg') {
    let at = 2
    while (at + 4 < bytes.length) {
      if (bytes[at++] !== 255) break
      while (bytes[at] === 255) at++
      const marker = bytes[at++]
      if (marker === 217 || marker === 218) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (at + 2 > bytes.length) break
      const length = dv.getUint16(at)
      if (length < 2 || at + length > bytes.length) break
      if (
        [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) &&
        length >= 7
      ) {
        const h = dv.getUint16(at + 3),
          w = dv.getUint16(at + 5)
        if (w > 0 && h > 0) return [w, h]
      }
      at += length
    }
  }
}

interface SerializationContext {
  zip: JSZip
  nextImage: number
  mediaBytes: number
  contentWidth: number
  imageExtensions: Set<string>
  footnoteIds: Map<number, number>
  endnoteIds: Map<number, number>
}

function imageXml(image: LegacyDocImage, part: PartContext, context: SerializationContext): string {
  const bytes = rasterBytes(image)
  if (!bytes) return ''
  if (context.mediaBytes + bytes.length > MAX_MEDIA_BYTES) throw new LegacyDocImportError()
  context.mediaBytes += bytes.length
  const id = context.nextImage++
  const ext = image.mime === 'image/png' ? 'png' : 'jpeg'
  const filename = `legacy-image-${id}.${ext}`
  context.zip.file(`word/media/${filename}`, bytes)
  context.imageExtensions.add(ext)
  const rId = relationship(part, 'image', `media/${filename}`)
  const pixels = rasterSize(bytes, image.mime)
  const originalW = number(image.dxa, 1, 31680) ?? (pixels ? pixels[0] * 15 : 1440)
  const originalH = number(image.dya, 1, 31680) ?? (pixels ? pixels[1] * 15 : 1440)
  // Keep valid PICF display dimensions; scale only the unbounded intrinsic fallback.
  const scale = image.dxa && image.dya ? 1 : Math.min(1, context.contentWidth / originalW)
  const cx = Math.max(1, Math.round(originalW * scale * 635))
  const cy = Math.max(1, Math.round(originalH * scale * 635))
  return (
    '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Image ${id}"/>` +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${filename}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
    '</a:graphicData></a:graphic></wp:inline></w:drawing>'
  )
}

function serializeRun(run: LegacyDocRun, part: PartContext, context: SerializationContext): string {
  const footnote = run.ftnRef !== undefined ? context.footnoteIds.get(run.ftnRef) : undefined
  const endnote = run.endRef !== undefined ? context.endnoteIds.get(run.endRef) : undefined
  const content =
    textXml(run.text ?? '') +
    (run.image ? imageXml(run.image, part, context) : '') +
    (footnote !== undefined ? `<w:footnoteReference w:id="${footnote}"/>` : '') +
    (endnote !== undefined ? `<w:endnoteReference w:id="${endnote}"/>` : '')
  if (!content) return ''
  const properties =
    footnote !== undefined || endnote !== undefined
      ? runProperties({ ...run, va: run.va ?? 'super' })
      : runProperties(run)
  const xml = `<w:r>${properties}${content}</w:r>`
  const url = safeLink(run.url)
  return url
    ? `<w:hyperlink r:id="${relationship(part, 'hyperlink', url, true)}">${xml}</w:hyperlink>`
    : xml
}

function serializeParagraph(
  paragraph: LegacyDocParagraph,
  part: PartContext,
  context: SerializationContext,
): string {
  // Preserve only a recovered source marker, as text. A list membership flag
  // without its definition must not turn a heading into an invented bullet.
  const marker = paragraph.list?.marker
  const prefix = marker
    ? serializeRun(
        { ...paragraph.runs[0], image: undefined, url: undefined, text: `${marker}\t` },
        part,
        context,
      )
    : ''
  return `<w:p>${paragraphProperties(paragraph)}${prefix}${paragraph.runs.map((run) => serializeRun(run, part, context)).join('')}</w:p>`
}

type SourceCell = LegacyDocParagraph[]
type SourceRow = SourceCell[]

function rowWidths(row: SourceRow): number[] | undefined {
  const boundaries = row.at(-1)?.at(-1)?.tblw
  if (!boundaries || boundaries.length !== row.length + 1) return
  const widths = boundaries.slice(1).map((end, i) => number(end - boundaries[i], 1, 31680))
  return widths.every((width) => width !== undefined) ? (widths as number[]) : undefined
}

function serializeTable(
  rows: SourceRow[],
  part: PartContext,
  context: SerializationContext,
): string {
  const maxCells = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const widestRow = rows.find((row) => row.length === maxCells)!
  const grid =
    rowWidths(widestRow) ??
    (Array(maxCells).fill(Math.max(1, Math.floor(context.contentWidth / maxCells))) as number[])
  const totalWidth = grid.reduce((sum, width) => sum + width, 0)
  const indent = number(widestRow.at(-1)?.at(-1)?.tblw?.[0], -31680, 31680) ?? 0
  const rowXml = rows
    .map((row) => {
      const metadata = row.at(-1)!.at(-1)!
      const widths = rowWidths(row) ?? row.map((_, i) => grid[i] ?? grid[0])
      const cells: string[] = []
      for (let i = 0; i < row.length; i++) {
        const merge = metadata.tblMerge?.[i]
        let span = 1
        if (merge?.h === 'start') {
          while (i + span < row.length && metadata.tblMerge?.[i + span]?.h === 'cont') span++
        }
        const width = widths.slice(i, i + span).reduce((sum, value) => sum + value, 0)
        const fill = color(metadata.tblShd?.[i])
        const properties =
          `<w:tcW w:w="${width}" w:type="dxa"/>` +
          (span > 1 ? `<w:gridSpan w:val="${span}"/>` : '') +
          (merge?.v ? `<w:vMerge${merge.v === 'restart' ? ' w:val="restart"' : ''}/>` : '') +
          (fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '')
        const content = row
          .slice(i, i + span)
          .flat()
          .map((paragraph) => serializeParagraph(paragraph, part, context))
          .join('')
        cells.push(`<w:tc><w:tcPr>${properties}</w:tcPr>${content}</w:tc>`)
        i += span - 1
      }
      return `<w:tr>${cells.join('')}</w:tr>`
    })
    .join('')
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${totalWidth}" w:type="dxa"/><w:tblInd w:w="${indent}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid>${grid.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rowXml}</w:tbl>`
  )
}

function serializeStory(
  paragraphs: LegacyDocParagraph[],
  part: PartContext,
  context: SerializationContext,
): string {
  const elements: string[] = []
  let rows: SourceRow[] = []
  let row: SourceRow = []
  let cell: SourceCell = []
  function flushTable() {
    if (cell.length) row.push(cell)
    if (row.length) rows.push(row)
    if (rows.length) elements.push(serializeTable(rows, part, context))
    rows = []
    row = []
    cell = []
  }
  for (const paragraph of paragraphs) {
    if (paragraph.kind !== 'p') {
      cell.push(paragraph)
      row.push(cell)
      cell = []
      if (paragraph.kind === 'rowEnd') {
        rows.push(row)
        row = []
      }
    } else if (paragraph.inTable) {
      cell.push(paragraph)
    } else {
      flushTable()
      elements.push(serializeParagraph(paragraph, part, context))
    }
  }
  flushTable()
  // Word requires a paragraph after the final table, including in headers.
  if (!elements.length || elements.at(-1)!.endsWith('</w:tbl>')) elements.push('<w:p/>')
  return elements.join('')
}

function pageSettings(page: LegacyDocPage = {}): Required<LegacyDocPage> {
  return {
    width: number(page.width, 1, 31680) ?? 11906,
    height: number(page.height, 1, 31680) ?? 16838,
    top: number(page.top, -31680, 31680) ?? 1440,
    bottom: number(page.bottom, -31680, 31680) ?? 1440,
    left: number(page.left, 0, 31680) ?? 1440,
    right: number(page.right, 0, 31680) ?? 1440,
    landscape: !!page.landscape,
    cols: number(page.cols, 1, 45) ?? 1,
  }
}

/** Controlled OOXML serialization; exported here for structured model tests. */
export async function legacyDocModelToDocx(model: LegacyDocModel): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await buildBlankDocx())
  const page = pageSettings(model.page ?? model.sections?.[0])
  const context: SerializationContext = {
    zip,
    nextImage: 1,
    mediaBytes: 0,
    contentWidth: Math.max(1, page.width - page.left - page.right),
    imageExtensions: new Set(),
    footnoteIds: new Map(),
    endnoteIds: new Map(),
  }
  const main: PartContext = {
    nextRelationship: 3,
    relationships: [
      `<Relationship Id="rId1" Type="${R_NS}/styles" Target="styles.xml"/>`,
      `<Relationship Id="rId2" Type="${R_NS}/numbering" Target="numbering.xml"/>`,
    ],
  }
  const overrides: string[] = []
  const refs: string[] = []
  // Only PLC text ranges establish note ownership. A flattened note story
  // cannot safely be indexed by paragraph: one note may contain many paragraphs.
  for (const kind of ['footnote', 'endnote'] as const) {
    const stories = kind === 'footnote' ? model.footnoteStories : model.endnoteStories
    if (!stories?.length) continue
    const ids = kind === 'footnote' ? context.footnoteIds : context.endnoteIds
    stories.forEach((_, index) => ids.set(index, index + 1))
    const part: PartContext = { nextRelationship: 1, relationships: [] }
    const notes = stories
      .map((paragraphs, index) => {
        const content = serializeStory(paragraphs, part, context).replace(
          /<w:p>(<w:pPr>[\s\S]*?<\/w:pPr>)?/,
          `$&<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:${kind}Ref/></w:r>`,
        )
        return `<w:${kind} w:id="${index + 1}">${content}</w:${kind}>`
      })
      .join('')
    const separators =
      `<w:${kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}>` +
      `<w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>`
    zip.file(
      `word/${kind}s.xml`,
      `${XML_DECL}<w:${kind}s ${DOC_NS}>${separators}${notes}</w:${kind}s>`,
    )
    if (part.relationships.length) zip.file(`word/_rels/${kind}s.xml.rels`, relsXml(part))
    relationship(main, `${kind}s`, `${kind}s.xml`)
    overrides.push(
      `<Override PartName="/word/${kind}s.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}s+xml"/>`,
    )
  }
  for (const kind of ['header', 'footer'] as const) {
    const paragraphs = model[kind]
    if (!paragraphs?.length) continue
    const part: PartContext = { nextRelationship: 1, relationships: [] }
    const tag = kind === 'header' ? 'hdr' : 'ftr'
    zip.file(
      `word/${kind}1.xml`,
      `${XML_DECL}<w:${tag} ${DOC_NS}>${serializeStory(paragraphs, part, context)}</w:${tag}>`,
    )
    if (part.relationships.length) zip.file(`word/_rels/${kind}1.xml.rels`, relsXml(part))
    refs.push(
      `<w:${kind}Reference w:type="default" r:id="${relationship(main, kind, `${kind}1.xml`)}"/>`,
    )
    overrides.push(
      `<Override PartName="/word/${kind}1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`,
    )
  }
  // Unmapped comments / textboxes keep their text and formatting in reading
  // order at the end, instead of being silently lost or assigned false anchors.
  // Raw headers contain separator stories and are deliberately not appended.
  const supplementary = [
    ...(model.footnoteStories?.length ? [] : model.footnotes),
    ...(model.endnoteStories?.length ? [] : model.endnotes),
    ...model.annotations,
    ...model.textboxes,
    ...model.headerTextboxes,
  ]
  const body = serializeStory([...model.body, ...supplementary], main, context)
  const section =
    `<w:sectPr>${refs.join('')}<w:pgSz w:w="${page.width}" w:h="${page.height}"${page.landscape ? ' w:orient="landscape"' : ''}/>` +
    `<w:pgMar w:top="${page.top}" w:right="${page.right}" w:bottom="${page.bottom}" w:left="${page.left}" w:header="708" w:footer="708" w:gutter="0"/>` +
    `<w:cols w:num="${page.cols}" w:space="720"/></w:sectPr>`
  zip.file(
    'word/document.xml',
    `${XML_DECL}<w:document ${DOC_NS}><w:body>${body}${section}</w:body></w:document>`,
  )
  zip.file('word/_rels/document.xml.rels', relsXml(main))
  if (model.props && Object.values(model.props).some(Boolean)) {
    const tags = {
      title: 'dc:title',
      subject: 'dc:subject',
      author: 'dc:creator',
      keywords: 'cp:keywords',
      comments: 'dc:description',
    }
    const content = (Object.keys(tags) as (keyof typeof tags)[])
      .flatMap((key) => {
        const value = model.props![key]
        return value ? `<${tags[key]}>${escapeXml(value)}</${tags[key]}>` : []
      })
      .join('')
    zip.file(
      'docProps/core.xml',
      `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">${content}</cp:coreProperties>`,
    )
    const packageRels = await zip.file('_rels/.rels')!.async('string')
    zip.file(
      '_rels/.rels',
      packageRels.replace(
        '</Relationships>',
        `<Relationship Id="rIdLegacyCore" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
      ),
    )
    overrides.push(
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    )
  }
  const types = await zip.file('[Content_Types].xml')!.async('string')
  const imageTypes = [...context.imageExtensions].map(
    (ext) => `<Default Extension="${ext}" ContentType="image/${ext}"/>`,
  )
  zip.file(
    '[Content_Types].xml',
    types.replace('</Types>', `${imageTypes.join('')}${overrides.join('')}</Types>`),
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
