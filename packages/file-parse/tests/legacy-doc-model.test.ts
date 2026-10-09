import { readFileSync } from 'node:fs'
import * as CFB from 'cfb'
import { describe, expect, it } from 'vitest'
import { docToText } from '../src/doc'
import { readLegacyDocModel } from '../src/legacy-doc-model'

const fixture = readFileSync(new URL('fixtures/legacy-sample.doc', import.meta.url))

function rewriteWordDocument(edit: (word: Buffer, table: Buffer) => void): Uint8Array {
  const cfb = CFB.read(fixture, { type: 'buffer' })
  const word = CFB.find(cfb, 'WordDocument')!
  const table = CFB.find(cfb, '1Table')!
  const wordBytes = Buffer.from(word.content)
  const tableBytes = Buffer.from(table.content)
  edit(wordBytes, tableBytes)
  word.content = wordBytes
  table.content = tableBytes
  return CFB.write(cfb, { type: 'buffer' })
}

function fibPairsOffset(word: Buffer): number {
  let pos = 0x20
  pos += 2 + word.readUInt16LE(pos) * 2
  pos += 2 + word.readUInt16LE(pos) * 4
  return pos + 2
}

function fixtureWithNotes(includeGrouping = true): Uint8Array {
  const cfb = CFB.read(fixture, { type: 'buffer' })
  const wordEntry = CFB.find(cfb, 'WordDocument')!
  const tableEntry = CFB.find(cfb, '1Table')!
  const originalWord = Buffer.from(wordEntry.content)
  let table = Buffer.from(tableEntry.content)
  const fibPairs = fibPairsOffset(originalWord)
  let longWords = 0x20
  longWords += 2 + originalWord.readUInt16LE(longWords) * 2
  longWords += 2
  const bodyLength = originalWord.readUInt32LE(longWords + 3 * 4)
  const firstNote = '\u0002First footnote paragraph\rSecond footnote paragraph\r'
  const secondNote = '\u0002Second footnote\r'
  const footnotes = firstNote + secondNote + '\r'
  const endnotes = '\u0002Endnote paragraph one\rEndnote paragraph two\r\r'
  const noteOffset = originalWord.length + (originalWord.length % 2)
  const footnoteBytes = Buffer.from(footnotes, 'utf16le')
  const word = Buffer.concat([
    originalWord,
    Buffer.alloc(noteOffset - originalWord.length),
    footnoteBytes,
    Buffer.from(endnotes, 'utf16le'),
  ])
  word.writeUInt32LE(word.length, longWords)
  word.writeUInt32LE(footnotes.length, longWords + 4 * 4)
  word.writeUInt32LE(endnotes.length, longWords + 8 * 4)

  const originalClx = word.readUInt32LE(fibPairs + 33 * 8)
  const oldCount = (table.readUInt32LE(originalClx + 1) - 4) / 12
  const firstPcd = table.subarray(
    originalClx + 5 + (oldCount + 1) * 4,
    originalClx + 5 + (oldCount + 1) * 4 + 8,
  )
  const firstFc = firstPcd.readUInt32LE(2)
  const compressed = (firstFc & 0x40000000) !== 0
  const textOffset = compressed ? (firstFc & 0x3fffffff) >>> 1 : firstFc & 0x3fffffff
  for (let cp = 0; cp < 3; cp++) {
    const offset = textOffset + cp * (compressed ? 1 : 2)
    word[offset] = 0x02
    if (!compressed) word[offset + 1] = 0
  }

  function appendTable(index: number, value: Buffer): void {
    word.writeUInt32LE(table.length, fibPairs + index * 8)
    word.writeUInt32LE(value.length, fibPairs + index * 8 + 4)
    table = Buffer.concat([table, value])
  }
  const clx = Buffer.alloc(45)
  clx[0] = 0x02
  clx.writeUInt32LE(40, 1)
  const boundaries = [
    0,
    bodyLength,
    bodyLength + footnotes.length,
    bodyLength + footnotes.length + endnotes.length,
  ]
  boundaries.forEach((cp, i) => clx.writeUInt32LE(cp, 5 + i * 4))
  firstPcd.copy(clx, 21)
  clx.writeUInt32LE(noteOffset, 31)
  clx.writeUInt32LE(noteOffset + footnoteBytes.length, 39)
  appendTable(33, clx)

  function cpTable(values: number[]): Buffer {
    const value = Buffer.alloc(values.length * 4)
    values.forEach((cp, i) => value.writeUInt32LE(cp, i * 4))
    return value
  }
  const footnoteRefs = Buffer.alloc(16)
  cpTable([0, 1, bodyLength]).copy(footnoteRefs)
  footnoteRefs.writeUInt16LE(1, 12)
  footnoteRefs.writeUInt16LE(1, 14)
  appendTable(2, footnoteRefs)
  const endnoteRefs = Buffer.alloc(10)
  cpTable([2, bodyLength]).copy(endnoteRefs)
  endnoteRefs.writeUInt16LE(1, 8)
  appendTable(46, endnoteRefs)
  if (includeGrouping) {
    appendTable(3, cpTable([0, firstNote.length, footnotes.length - 1, 0xffffffff]))
    appendTable(47, cpTable([0, endnotes.length - 1, 0xffffffff]))
  }
  wordEntry.content = word
  wordEntry.size = word.length
  tableEntry.content = table
  tableEntry.size = table.length
  return CFB.write(cfb, { type: 'buffer' })
}

describe('readLegacyDocModel', () => {
  it('recovers editable text, styled runs, paragraph spacing and page setup', async () => {
    const model = readLegacyDocModel(fixture)!
    expect(model).not.toBeNull()
    expect(model.body).toHaveLength(3)
    expect(model.body[0].runs[0]).toMatchObject({
      text: 'Legacy Report',
      b: true,
      size: 18,
      font: 'Liberation Sans',
    })
    expect(model.body[0].pp).toEqual({ spB: 240, spA: 120 })
    expect(model.body[1].runs[0]).toMatchObject({
      text: 'Legacy DOC body text',
      b: false,
      size: 12,
      font: 'Liberation Serif',
    })
    expect(model.page).toEqual({
      width: 11906,
      height: 16838,
      left: 1134,
      right: 1134,
      top: 1134,
      bottom: 1134,
    })
    expect(model.sections).toEqual([model.page])
    const text = model.body
      .map((paragraph) => paragraph.runs.map((run) => run.text ?? '').join(''))
      .join('\n')
    expect(text).toBe(await docToText(fixture))
    expect(model.footnotes).toEqual([])
    expect(model.headers).toEqual([])
    expect(model).not.toHaveProperty('html')
    expect(JSON.parse(JSON.stringify(model))).toEqual(model)
  })

  it('honours an input view offset without reading bytes outside the document', () => {
    const padded = Buffer.concat([Buffer.alloc(17, 0xaa), fixture, Buffer.alloc(19, 0xbb)])
    expect(readLegacyDocModel(padded.subarray(17, 17 + fixture.length))).toEqual(
      readLegacyDocModel(fixture),
    )
  })

  it('groups multi-paragraph footnotes/endnotes by their PLC ranges and keeps reference indexes', () => {
    const model = readLegacyDocModel(fixtureWithNotes())!
    expect(model).not.toBeNull()
    const texts = (paragraphs: NonNullable<typeof model>['body']) =>
      paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text ?? '').join(''))
    expect(model.footnoteStories?.map(texts)).toEqual([
      ['First footnote paragraph', 'Second footnote paragraph'],
      ['Second footnote'],
    ])
    expect(model.endnoteStories?.map(texts)).toEqual([
      ['Endnote paragraph one', 'Endnote paragraph two'],
    ])
    const runs = model.body.flatMap((paragraph) => paragraph.runs)
    expect(runs.filter((run) => run.ftnRef !== undefined).map((run) => run.ftnRef)).toEqual([0, 1])
    expect(runs.filter((run) => run.endRef !== undefined).map((run) => run.endRef)).toEqual([0])
    expect(JSON.parse(JSON.stringify(model))).toEqual(model)
  })

  it('retains flat note content when a grouping PLC is unavailable', () => {
    const model = readLegacyDocModel(fixtureWithNotes(false))!
    expect(model).not.toBeNull()
    expect(model.footnoteStories).toBeUndefined()
    expect(model.endnoteStories).toBeUndefined()
    expect(
      model.footnotes
        .flatMap((paragraph) => paragraph.runs)
        .map((run) => run.text)
        .join('\n'),
    ).toContain('Second footnote paragraph')
    expect(
      model.endnotes
        .flatMap((paragraph) => paragraph.runs)
        .map((run) => run.text)
        .join('\n'),
    ).toContain('Endnote paragraph two')
  })

  it.each([new Uint8Array(), Buffer.from('not a Word document'), Buffer.alloc(512)])(
    'returns null for empty or wrong-format input',
    (input) => {
      expect(readLegacyDocModel(input)).toBeNull()
    },
  )

  it.each([512, 1024, fixture.length - 512, fixture.length - 1])(
    'returns null for a document truncated to %i bytes',
    (length) => {
      expect(readLegacyDocModel(fixture.subarray(0, length))).toBeNull()
    },
  )

  it('rejects inconsistent sector geometry and impossible FAT counts', () => {
    const badGeometry = Buffer.from(fixture)
    badGeometry.writeUInt16LE(5, 32)
    expect(readLegacyDocModel(badGeometry)).toBeNull()
    const badFatCount = Buffer.from(fixture)
    badFatCount.writeUInt32LE(fixture.length, 44)
    expect(readLegacyDocModel(badFatCount)).toBeNull()
  })

  it.each([0x0100, 0x8000])('rejects protected Word documents (flag %i)', (flag) => {
    const input = rewriteWordDocument((word) =>
      word.writeUInt16LE(word.readUInt16LE(10) | flag, 10),
    )
    expect(readLegacyDocModel(input)).toBeNull()
  })

  it('rejects a corrupt CLX record length', () => {
    const input = rewriteWordDocument((word, table) => {
      const clx = word.readUInt32LE(fibPairsOffset(word) + 33 * 8)
      table[clx] = 0x01
      table.writeInt16LE(-1, clx + 1)
    })
    expect(readLegacyDocModel(input)).toBeNull()
  })

  it('returns JSON-safe PNG image bytes beside styled document runs', () => {
    const cfb = CFB.read(fixture, { type: 'buffer' })
    const word = CFB.find(cfb, 'WordDocument')!
    const table = Buffer.from(CFB.find(cfb, '1Table')!.content)
    const bytes = Buffer.from(word.content)
    const clx = bytes.readUInt32LE(fibPairsOffset(bytes) + 33 * 8)
    const pieces = (table.readUInt32LE(clx + 1) - 4) / 12
    const firstFc = table.readUInt32LE(clx + 5 + (pieces + 1) * 4 + 2)
    const compressed = (firstFc & 0x40000000) !== 0
    const textOffset = compressed ? (firstFc & 0x3fffffff) >>> 1 : firstFc & 0x3fffffff
    bytes[textOffset] = 0x01
    if (!compressed) bytes[textOffset + 1] = 0
    word.content = bytes
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVmkAAAAASUVORK5CYII=',
      'base64',
    )
    CFB.utils.cfb_add(cfb, 'FaamTestImage', png)
    const model = readLegacyDocModel(CFB.write(cfb, { type: 'buffer' }))!
    expect(model).not.toBeNull()
    const image = model.body.flatMap((paragraph) => paragraph.runs).find((run) => run.image)?.image
    expect(image).toEqual({ mime: 'image/png', bytes: Array.from(png) })
    expect(JSON.parse(JSON.stringify(model))).toEqual(model)
    expect(model).not.toHaveProperty('html')
  })
})
