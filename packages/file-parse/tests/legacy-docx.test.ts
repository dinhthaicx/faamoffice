import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { XMLValidator } from 'fast-xml-parser'
import { parseDocx, readSectionSettings } from '@genoffice/docx-engine'
import { describe, expect, it } from 'vitest'
import { convertLegacyDocToDocx, LegacyDocImportError } from '../src/index'
import { legacyDocModelToDocx } from '../src/legacy-docx'
import type { LegacyDocModel, LegacyDocParagraph } from '../src/legacy-doc-model'

const PNG = Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  ),
)

function paragraph(text: string, fields: Partial<LegacyDocParagraph> = {}): LegacyDocParagraph {
  return { kind: 'p', align: 0, list: null, runs: [{ text }], ...fields }
}

function model(fields: Partial<LegacyDocModel>): LegacyDocModel {
  return {
    body: [],
    footnotes: [],
    headers: [],
    annotations: [],
    endnotes: [],
    textboxes: [],
    headerTextboxes: [],
    ...fields,
  }
}

async function converted(fields: Partial<LegacyDocModel>) {
  const bytes = await legacyDocModelToDocx(model(fields))
  const zip = await JSZip.loadAsync(bytes)
  const parsed = await parseDocx(bytes)
  return { bytes, zip, parsed, xml: await zip.file('word/document.xml')!.async('string') }
}

describe('legacy Word to editable DOCX', () => {
  it('retains the real .doc fixture text, fonts, title styling and A4 page setup', async () => {
    const bytes = await readFile(new URL('fixtures/legacy-sample.doc', import.meta.url))
    // Pin the actual binary fixture, rather than accepting a synthetic DOCX as DOC.
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'a3d925b2e31fb364fb77989cb560d49e94be88a3728ecafb1851293d8d34c0e9',
    )
    const docx = await convertLegacyDocToDocx(bytes)
    const parsed = await parseDocx(docx)
    const blocks = parsed.blocks.filter((block) => !block.hidden)
    expect(blocks.map((block) => block.runs?.map((run) => run.text).join(''))).toEqual([
      'Legacy Report',
      'Legacy DOC body text',
      'Second paragraph from Word 97-2003.',
    ])
    expect(blocks[0].runs?.[0]).toMatchObject({
      font: 'Liberation Sans',
      sizeHalfPoints: 36,
      bold: true,
    })
    expect(blocks[1].runs?.[0]).toMatchObject({
      font: 'Liberation Serif',
      sizeHalfPoints: 24,
      bold: false,
    })
    expect(blocks[0].list).toBeUndefined()
    expect(parsed.internal.documentXml).not.toContain('<w:numPr>')
    expect(readSectionSettings(parsed)).toMatchObject({
      pageWidth: 11906,
      pageHeight: 16838,
      orientation: 'portrait',
      marginLeft: 1134,
      marginRight: 1134,
      marginTop: 1134,
      marginBottom: 1134,
    })
  })

  it.each([new Uint8Array(), new TextEncoder().encode('not a Word binary')])(
    'returns a clear unsupported error for unreadable input %#',
    async (bytes) => {
      await expect(convertLegacyDocToDocx(bytes)).rejects.toBeInstanceOf(LegacyDocImportError)
      await expect(convertLegacyDocToDocx(bytes)).rejects.toMatchObject({
        code: 'legacy_doc_unsupported',
      })
    },
  )

  it('retains rich runs, COLORREF colors, whitespace and escaped source text', async () => {
    const { parsed, xml } = await converted({
      body: [
        paragraph('', {
          runs: [
            {
              text: '  Tiếng Việt <&>\tline\nnext\u0000😀',
              font: 'A "quoted" & font',
              size: 10.5,
              b: true,
              i: true,
              u: true,
              uStyle: 'double',
              strike: true,
              dstrike: true,
              color: 0x563412,
              highlight: 0x00ffff,
              smallCaps: true,
              hidden: true,
              spacing: 1.5,
              position: -2,
              va: 'super',
            },
          ],
        }),
      ],
    })
    const run = parsed.blocks.find((block) => block.runs)?.runs?.[0]
    expect(run).toMatchObject({
      text: '  Tiếng Việt <&>\tline\nnext😀',
      font: 'A "quoted" & font',
      sizeHalfPoints: 21,
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      dstrike: true,
      color: '123456',
      highlight: 'yellow',
      caps: 'small',
      vanish: true,
      charSpacingTwips: 30,
      positionHalfPoints: -4,
    })
    expect(xml).toContain('<w:u w:val="double"/>')
    expect(xml).toContain('w:val="superscript"')
    expect(xml).not.toContain('\u0000')
    expect(XMLValidator.validate(xml)).toBe(true)
  })

  it('preserves paragraph indentation, spacing, tabs, shading and borders', async () => {
    const { xml, parsed } = await converted({
      body: [
        paragraph('Indented', {
          align: 3,
          pp: {
            indL: 720,
            indR: 360,
            ind1: -360,
            spB: 120,
            spA: 240,
            line: -300,
            lineMult: 0,
            keepNext: 1,
            keepLines: 1,
            pageBreak: 1,
            tabs: [{ pos: 1440, align: 'right', leader: 'dot' }],
            shd: 0xffccaa,
            borders: { bottom: { type: 3, width: 1.5, color: 0x563412 } },
          },
        }),
      ],
    })
    expect(xml).toContain('<w:ind w:left="720" w:right="360" w:hanging="360"/>')
    expect(xml).toContain('w:before="120" w:after="240" w:line="300" w:lineRule="exact"')
    expect(xml).toContain('<w:tab w:val="right" w:leader="dot" w:pos="1440"/>')
    expect(xml).toContain('<w:bottom w:val="double" w:sz="12" w:color="123456"/>')
    expect(parsed.blocks.find((block) => block.runs)?.format?.align).toBe('justify')
    expect(XMLValidator.validate(xml)).toBe(true)
  })

  it('keeps recovered list markers as text and does not invent missing markers', async () => {
    const { parsed, xml } = await converted({
      body: [
        paragraph('Heading', { list: { ilfo: 1, ilvl: 0, kind: 'bullet', marker: '' } }),
        paragraph('Item', { list: { ilfo: 2, ilvl: 1, kind: 'number', marker: '2.3.' } }),
      ],
    })
    const text = parsed.blocks
      .filter((block) => block.runs)
      .map((block) => block.runs!.map((run) => run.text).join(''))
    expect(text).toEqual(['Heading', '2.3.\tItem'])
    expect(xml).not.toContain('<w:numPr>')
    expect(xml).not.toContain('•')
  })

  it('keeps empty cells and multiple paragraphs in their source table cell', async () => {
    const { parsed, xml } = await converted({
      body: [
        paragraph('Before'),
        paragraph('First line', { inTable: true }),
        paragraph('Second line', { kind: 'cell', inTable: true }),
        paragraph('', {
          kind: 'rowEnd',
          inTable: true,
          tblw: [120, 2120, 5120],
          tblShd: [0x00ffff, null],
        }),
        paragraph('Row two', { kind: 'cell', inTable: true }),
        paragraph('Last cell', { kind: 'rowEnd', inTable: true, tblw: [120, 2120, 5120] }),
        paragraph('After'),
      ],
    })
    const table = parsed.blocks.find((block) => block.type === 'table')?.table
    expect(table?.colWidthsTwips).toEqual([2000, 3000])
    expect(table?.rows).toHaveLength(2)
    expect(table?.rows[0]).toHaveLength(2)
    expect(table?.rows[0][0].paras).toEqual(['First line', 'Second line'])
    expect(table?.rows[0][0].fill).toBe('FFFF00')
    expect(table?.rows[0][1].paras).toEqual([''])
    expect(table?.rows[1][1].paras).toEqual(['Last cell'])
    expect(xml).toContain('<w:tblInd w:w="120" w:type="dxa"/>')
    expect(
      parsed.blocks
        .filter((block) => block.runs)
        .map((block) => block.runs!.map((run) => run.text).join('')),
    ).toEqual(['Before', 'After'])
  })

  it('retains horizontal and vertical merges without discarding cell content', async () => {
    const { parsed, xml } = await converted({
      body: [
        paragraph('Merged start', { kind: 'cell' }),
        paragraph('Merged continuation', {
          kind: 'rowEnd',
          tblw: [0, 2000, 4000],
          tblMerge: [
            { h: 'start', v: 'restart' },
            { h: 'cont', v: null },
          ],
        }),
        paragraph('', { kind: 'cell' }),
        paragraph('Still visible', {
          kind: 'rowEnd',
          tblw: [0, 2000, 4000],
          tblMerge: [{ h: null, v: 'cont' }, null],
        }),
      ],
    })
    const table = parsed.blocks.find((block) => block.type === 'table')?.table
    expect(table?.rows[0][0]).toMatchObject({ colSpan: 2, vMerge: 'restart' })
    expect(table?.rows[0][0].paras).toEqual(['Merged start', 'Merged continuation'])
    expect(table?.rows[1][0].vMerge).toBe('continue')
    expect(table?.rows[1][1].paras).toEqual(['Still visible'])
    expect(xml).toContain('<w:gridSpan w:val="2"/>')
    expect(XMLValidator.validate(xml)).toBe(true)
  })

  it('embeds PNG bytes and source display size as editable inline drawing', async () => {
    const { zip, xml, parsed } = await converted({
      body: [
        paragraph('', {
          runs: [
            {
              image: { mime: 'image/png', bytes: PNG, dxa: 1440, dya: 720 },
            },
          ],
        }),
      ],
    })
    const media = zip.file('word/media/legacy-image-1.png')
    expect(media).not.toBeNull()
    expect(Array.from(await media!.async('uint8array'))).toEqual(PNG)
    expect(xml).toContain('<wp:extent cx="914400" cy="457200"/>')
    expect(parsed.blocks.find((block) => block.type === 'image')).toMatchObject({
      imageWidthPx: 96,
      imageHeightPx: 48,
    })
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain(
      'ContentType="image/png"',
    )
  })

  it('uses the image intrinsic dimensions when PICF dimensions are missing', async () => {
    const { xml } = await converted({
      body: [paragraph('', { runs: [{ image: { mime: 'image/png', bytes: PNG } }] })],
    })
    expect(xml).toContain('<wp:extent cx="9525" cy="9525"/>')
  })

  it('skips unsupported or falsely labeled image data while retaining adjacent text', async () => {
    const { zip, parsed } = await converted({
      body: [
        paragraph('', {
          runs: [
            {
              text: 'Safe text',
              image: {
                mime: 'image/png',
                bytes: Array.from(Buffer.from('<svg onload="evil()"/>')),
              },
            },
          ],
        }),
      ],
    })
    expect(zip.file(/^word\/media\//)).toHaveLength(0)
    expect(parsed.blocks.find((block) => block.runs)?.runs?.[0].text).toBe('Safe text')
  })

  it('writes header/footer stories with their own image/link relationships', async () => {
    const { zip, parsed, xml } = await converted({
      body: [paragraph('Body')],
      headers: [paragraph('Separator noise must not become a header')],
      header: [
        paragraph('Company header', {
          runs: [
            { text: 'Company header', b: true, url: 'https://example.org/header?a=1&b=2' },
            { image: { mime: 'image/png', bytes: PNG, dxa: 300, dya: 300 } },
          ],
        }),
      ],
      footer: [paragraph('Confidential', { align: 1, runs: [{ text: 'Confidential', i: true }] })],
    })
    expect(parsed.headerText).toContain('Company header')
    expect(parsed.footerText).toBe('Confidential')
    expect(parsed.headerImages).toHaveLength(1)
    const rels = await zip.file('word/_rels/header1.xml.rels')!.async('string')
    expect(rels).toContain('Target="media/legacy-image-1.png"')
    expect(rels).toContain('Target="https://example.org/header?a=1&amp;b=2"')
    expect(xml).toContain('<w:headerReference w:type="default"')
    expect(xml).not.toContain('Separator noise')
    for (const part of zip.file(/\.xml$/))
      expect(XMLValidator.validate(await part.async('string'))).toBe(true)
  })

  it('allows safe links and drops active/file targets without importing raw HTML', async () => {
    const { zip, parsed, xml } = await converted({
      body: [
        paragraph('', {
          runs: [
            { text: '<script>literal & safe</script>', url: 'javascript:alert(1)' },
            { text: ' file', url: 'file:///etc/passwd' },
            { text: ' data', url: 'data:text/html,unsafe' },
            { text: ' control', url: 'https://example.org/\nunsafe' },
            { text: ' website', url: 'https://example.org/?a=1&b=2' },
            { text: ' email', url: 'mailto:hello@example.org' },
          ],
        }),
      ],
    })
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string')
    expect(rels).not.toMatch(/javascript:|file:|data:|unsafe/)
    expect(rels).toContain('https://example.org/?a=1&amp;b=2')
    expect(rels).toContain('mailto:hello@example.org')
    expect(xml).not.toContain('<script>')
    expect(
      parsed.blocks
        .find((block) => block.runs)
        ?.runs?.map((run) => run.text)
        .join(''),
    ).toBe('<script>literal & safe</script> file data control website email')
    expect(zip.file(/vbaProject|altChunk|\.html$/)).toHaveLength(0)
  })

  it('keeps first-section landscape geometry and escaped document properties', async () => {
    const { zip, parsed } = await converted({
      body: [paragraph('Landscape')],
      sections: [
        {
          width: 16838,
          height: 11906,
          left: 720,
          right: 720,
          top: 0,
          bottom: -720,
          landscape: true,
          cols: 2,
        },
        { width: 12240, height: 15840 },
      ],
      props: { title: 'A <report>', author: 'Author & contributor', comments: 'Description' },
    })
    expect(readSectionSettings(parsed)).toMatchObject({
      pageWidth: 16838,
      pageHeight: 11906,
      orientation: 'landscape',
      marginTop: 0,
      marginBottom: 720,
      marginBottomFixed: true,
      columns: 2,
    })
    const core = await zip.file('docProps/core.xml')!.async('string')
    expect(core).toContain('<dc:title>A &lt;report&gt;</dc:title>')
    expect(core).toContain('<dc:creator>Author &amp; contributor</dc:creator>')
    expect(XMLValidator.validate(core)).toBe(true)
  })

  it('links references to grouped, multi-paragraph footnotes and endnotes with source formatting', async () => {
    const first = paragraph('First note', {
      runs: [{ text: 'First note', b: true, font: 'Liberation Serif', size: 10 }],
    })
    const second = paragraph('Second note')
    const { zip, parsed, xml } = await converted({
      body: [
        paragraph('', {
          runs: [{ text: 'Body' }, { ftnRef: 1 }, { text: ' then' }, { ftnRef: 0 }, { endRef: 0 }],
        }),
      ],
      footnotes: [first, paragraph('More of first note'), second],
      footnoteStories: [[first, paragraph('More of first note')], [second]],
      endnotes: [paragraph('Endnote'), paragraph('More endnote')],
      endnoteStories: [
        [paragraph('Endnote', { runs: [{ text: 'Endnote', i: true }] }), paragraph('More endnote')],
      ],
    })
    expect(parsed.footnotes).toHaveLength(2)
    expect(parsed.footnotes[0]).toMatchObject({ id: '1', text: 'First note\nMore of first note' })
    expect(parsed.footnotes[0].richParas?.[0][0]).toMatchObject({
      text: 'First note',
      bold: true,
      fontAscii: 'Liberation Serif',
      sizeHalfPoints: 20,
    })
    expect(parsed.footnotes[1]).toMatchObject({ id: '2', text: 'Second note' })
    expect(parsed.endnotes[0]).toMatchObject({ id: '1', text: 'Endnote\nMore endnote' })
    expect(parsed.endnotes[0].richParas?.[0][0]).toMatchObject({ text: 'Endnote', italic: true })
    const refs = parsed.blocks.flatMap(
      (block) => block.runs?.flatMap((run) => (run.noteRef ? [run.noteRef] : [])) ?? [],
    )
    expect(refs).toEqual([
      { kind: 'footnote', id: '2' },
      { kind: 'footnote', id: '1' },
      { kind: 'endnote', id: '1' },
    ])
    expect(xml).not.toContain('More of first note')
    expect(xml).not.toContain('More endnote')
    for (const part of zip.file(/\.xml$/))
      expect(XMLValidator.validate(await part.async('string'))).toBe(true)
  })

  it('keeps note images and safe links in the note part relationship scope', async () => {
    const { zip, xml } = await converted({
      body: [paragraph('', { runs: [{ text: 'Body' }, { ftnRef: 0 }] })],
      footnoteStories: [
        [
          paragraph('', {
            runs: [
              { text: 'Source', url: 'https://example.org/notes' },
              { image: { mime: 'image/png', bytes: PNG, dxa: 300, dya: 300 } },
            ],
          }),
        ],
      ],
    })
    const notes = await zip.file('word/footnotes.xml')!.async('string')
    const rels = await zip.file('word/_rels/footnotes.xml.rels')!.async('string')
    expect(notes).toContain('<w:footnoteRef/>')
    expect(rels).toContain('Target="https://example.org/notes"')
    expect(rels).toContain('Target="media/legacy-image-1.png"')
    expect(xml).toContain('<w:footnoteReference w:id="1"/>')
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain(
      'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"',
    )
  })

  it('retains unmapped story text at the end instead of guessing note ownership or textbox anchors', async () => {
    const { parsed, xml } = await converted({
      body: [
        paragraph('', {
          runs: [{ text: 'Body' }, { ftnRef: 5 }, { endRef: 0 }, { tbxRef: 0 }, { comRef: 0 }],
        }),
      ],
      footnotes: [
        paragraph('Unmapped footnote', { runs: [{ text: 'Unmapped footnote', b: true }] }),
      ],
      endnotes: [paragraph('Unmapped endnote')],
      annotations: [paragraph('Comment text')],
      textboxes: [paragraph('Textbox text')],
      headerTextboxes: [paragraph('Header textbox')],
      headers: [paragraph('Separator noise')],
    })
    const text = parsed.blocks
      .filter((block) => block.runs)
      .map((block) => block.runs!.map((run) => run.text).join(''))
    expect(text).toEqual([
      'Body',
      'Unmapped footnote',
      'Unmapped endnote',
      'Comment text',
      'Textbox text',
      'Header textbox',
    ])
    expect(
      parsed.blocks.find((block) => block.runs?.[0]?.text === 'Unmapped footnote')?.runs?.[0].bold,
    ).toBe(true)
    expect(parsed.footnotes).toHaveLength(0)
    expect(xml).not.toContain('footnoteReference')
    expect(xml).not.toContain('Separator noise')
    expect(xml.match(/Textbox text/g)).toHaveLength(1)
  })
})
