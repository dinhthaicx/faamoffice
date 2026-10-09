# Legacy Word reader provenance

- Upstream: https://github.com/Alpaq92/JSDoc
- Pinned revision: `4265b8da29b239f5a7680b01e6c96a6c782aaa7f`
- Original source: https://github.com/Alpaq92/JSDoc/blob/4265b8da29b239f5a7680b01e6c96a6c782aaa7f/src/docToText.js
- Original source SHA-256: `1480cd409c36b0e8890509516ff6909dffd73a825211e821e1e09b880fc635db`
- License: Zero-Clause BSD (`0BSD`); the unchanged license text is in `legacy-doc.LICENSE`.
- This is a locally modified copy, not the unrelated npm package named `jsdoc`.

Local changes in `legacy-doc.cjs`:

1. The sole exported function returns the structured model. Upstream text, HTML,
   image and internal test entry points, text/HTML generation, and their unused
   helpers were removed. Runtime parsing has no DOM, filesystem, process, network
   or external dependency access.
2. CFB checks require a supported version/sector geometry, complete sectors,
   bounded FAT/DIFAT counts, bounded directory names and stream sizes. FAT,
   DIFAT and mini-FAT chains detect repeated sectors and incomplete or oversized
   chains. Stream reads are cached and their cumulative size is bounded by the
   input size. Stream-name maps have no object prototype.
3. CLX parsing rejects negative/overrunning record lengths and invalid piece-table
   sizes. Piece CPs must advance monotonically and every piece's character bytes
   must be present. Claimed story lengths cannot exceed the available pieces.
4. FKP/formatting reads check record/operand bounds, and section tables check their
   extent. Structural/resource errors propagate to the top-level `null` result
   instead of being swallowed by optional-property readers.
5. Resource ceilings are 50 MiB of input, 5,000,000 characters, 200,000 parsed
   records/runs, 200,000 combined output runs/paragraphs, 1,024 raster images,
   16 MiB of extracted image data and bounded image scanning work.
6. The paragraph model includes Word's `sprmPFInTable` flag, so consumers can
   preserve the paragraphs preceding a table cell's terminating mark. Ordinary
   cell-ending paragraphs retain their alignment/paragraph properties.
7. Individual footnote/endnote stories are grouped by the actual `PlcffndTxt`
   (FIB pair 3) / `PlcfendTxt` (pair 47) CP ranges. A group can contain several
   paragraphs and is indexed by the corresponding reference PLC record.
   The final undefined CP is ignored, the preceding CP must equal the story's
   length minus one, and ranges are bounded/monotonic. Flat stories remain
   available when the grouping PLC is absent. See the primary specifications:
   https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/b30472e7-569e-4c9c-a8ca-07fd5432f365
   and https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/49650ca7-1bfc-49e5-93ac-01a86bd2fc3e

`legacy-doc-model.ts` defines the public TypeScript model and converts raster
`Uint8Array` data to JSON-safe number arrays. Consumers must escape document
strings when writing XML, permit only safe hyperlink schemes and interpret Word
colour integers as COLORREF (`0x00BBGGRR`).

Known upstream import limits remain: Word 6/95 and encrypted/XOR-obfuscated
documents are unsupported; tracked changes are accepted; manual/page breaks
become paragraphs; exact pagination, section boundaries and floating-object
layout are not reconstructed. PNG/JPEG images are carved and paired with body
picture characters in order, so placement is best effort. WMF/EMF and non-raster
objects are unsupported. Headers/footers use the first section's preferred story.
An empty list marker means the list definition was unavailable. Tables preserve
cell/row marks and selected geometry, shading and merge metadata, not every
binary Word table feature.

Maintenance: review upstream changes against this pinned original and retain
the local guards/model-only surface when updating. The repository's public
`legacy-sample.doc` fixture checks text, fonts, bold/size, spacing and page setup;
reader tests also check ordinary malformed/truncated inputs and image byte
serialization. No native office converter or document upload is required.
