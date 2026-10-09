import readVendorModel from './vendor/legacy-doc.cjs'

/** Legacy Word colours are COLORREF integers (0x00BBGGRR), not CSS RGB. */
export interface LegacyDocImage {
  mime: 'image/png' | 'image/jpeg'
  /** JSON-safe raster bytes. Placement is best effort, in source picture order. */
  bytes: number[]
  /** Optional display dimensions in twips. */
  dxa?: number
  dya?: number
}

export interface LegacyDocRun {
  text?: string
  b?: boolean
  i?: boolean
  u?: boolean
  strike?: boolean
  size?: number | null
  font?: string | null
  color?: number | null
  va?: 'super' | 'sub'
  highlight?: number
  uStyle?: 'double' | 'dotted' | 'dashed' | 'wavy'
  smallCaps?: boolean
  caps?: boolean
  hidden?: boolean
  dstrike?: boolean
  /** Character spacing / baseline position in points. */
  spacing?: number
  position?: number
  /** Untrusted field target; consumers must allowlist URL schemes. */
  url?: string
  image?: LegacyDocImage
  ftnRef?: number
  endRef?: number
  comRef?: number
  tbxRef?: number
}

export interface LegacyDocBorder {
  color: number | null
  width: number
  type: number
}

export interface LegacyDocParagraphProperties {
  /** Indents, paragraph spacing and tab positions are twips. */
  indL?: number
  indR?: number
  ind1?: number
  spB?: number
  spA?: number
  line?: number
  lineMult?: number
  keepNext?: 1
  keepLines?: 1
  pageBreak?: 1
  tabs?: {
    pos: number
    align: 'left' | 'center' | 'right' | 'decimal' | 'bar'
    leader: 'none' | 'dot' | 'hyphen' | 'underscore' | 'heavy' | 'middot'
  }[]
  shd?: number
  borders?: Partial<Record<'top' | 'left' | 'bottom' | 'right', LegacyDocBorder>>
}

export interface LegacyDocParagraph {
  runs: LegacyDocRun[]
  /** Paragraphs before the cell-ending mark can also belong to the same cell. */
  inTable?: boolean
  /** Each cell / rowEnd node is a table cell; rowEnd closes the row. */
  kind: 'p' | 'cell' | 'rowEnd'
  /** Binary Word justification code: 0 left, 1 center, 2 right, 3 justified. */
  align: number
  list: {
    ilvl: number
    ilfo: number
    kind: 'bullet' | 'number'
    /** An empty marker means the source list definition was not recovered. */
    marker?: string
  } | null
  pp?: LegacyDocParagraphProperties
  /** Row column boundaries, in twips, attached to rowEnd. */
  tblw?: number[]
  tblShd?: (number | null)[]
  tblMerge?: ({ h: 'start' | 'cont' | null; v: 'restart' | 'cont' | null } | null)[]
}

export interface LegacyDocPage {
  width?: number
  height?: number
  top?: number
  bottom?: number
  left?: number
  right?: number
  landscape?: boolean
  cols?: number
}

export interface LegacyDocModel {
  body: LegacyDocParagraph[]
  footnotes: LegacyDocParagraph[]
  headers: LegacyDocParagraph[]
  annotations: LegacyDocParagraph[]
  endnotes: LegacyDocParagraph[]
  /** One PLC-delimited group per zero-based ftnRef/endRef index; notes may span paragraphs. */
  footnoteStories?: LegacyDocParagraph[][]
  endnoteStories?: LegacyDocParagraph[][]
  textboxes: LegacyDocParagraph[]
  headerTextboxes: LegacyDocParagraph[]
  /** First section's preferred actual page header / footer, when available. */
  header?: LegacyDocParagraph[]
  footer?: LegacyDocParagraph[]
  /** Page setup in twips. Section boundaries are not reconstructed. */
  page?: LegacyDocPage
  sections?: LegacyDocPage[]
  props?: Partial<Record<'title' | 'subject' | 'author' | 'keywords' | 'comments', string>>
  shapes?: { cp: number; xL: number; yT: number; xR: number; yB: number }[]
  bookmarks?: { name: string; start: number; end: number }[]
}

const storyNames = [
  'body',
  'footnotes',
  'headers',
  'annotations',
  'endnotes',
  'textboxes',
  'headerTextboxes',
  'header',
  'footer',
] as const

type StoryName = (typeof storyNames)[number]
const groupedStoryNames = ['footnoteStories', 'endnoteStories'] as const
type GroupedStoryName = (typeof groupedStoryNames)[number]
type NativeRun = Omit<LegacyDocRun, 'image'> & {
  image?: Omit<LegacyDocImage, 'bytes'> & { bytes: Uint8Array }
}
type NativeParagraph = Omit<LegacyDocParagraph, 'runs'> & { runs: NativeRun[] }
type NativeModel = Omit<LegacyDocModel, StoryName | GroupedStoryName> &
  Record<Exclude<StoryName, 'header' | 'footer'>, NativeParagraph[]> &
  Partial<Record<'header' | 'footer', NativeParagraph[]>> &
  Partial<Record<GroupedStoryName, NativeParagraph[][]>>

function jsonParagraph(paragraph: NativeParagraph): LegacyDocParagraph {
  return {
    ...paragraph,
    runs: paragraph.runs.map((run) => {
      const { image, ...fields } = run
      return image ? { ...fields, image: { ...image, bytes: Array.from(image.bytes) } } : fields
    }),
  }
}

/**
 * Read Word 97–2003 (.doc) offline into a styled, JSON-safe model.
 * Returns null for unsupported, encrypted, incomplete or oversized input.
 * This is a lossy import: changes are accepted and exact layout is not retained.
 * It executes no Word macros and returns no upstream HTML.
 */
export function readLegacyDocModel(bytes: Uint8Array): LegacyDocModel | null {
  const native = readVendorModel(bytes) as NativeModel | null
  if (!native) return null
  const model = { ...native } as LegacyDocModel
  for (const name of storyNames) {
    const paragraphs = native[name]
    if (!paragraphs) continue
    model[name] = paragraphs.map(jsonParagraph)
  }
  for (const name of groupedStoryNames) {
    const stories = native[name]
    if (stories) model[name] = stories.map((paragraphs) => paragraphs.map(jsonParagraph))
  }
  return model
}
