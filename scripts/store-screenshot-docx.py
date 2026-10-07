"""Create a small, synthetic Word fixture for real application screenshots."""
import sys
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED

source, target = map(Path, sys.argv[1:])
body = []
table = []


def paragraph(text, style=None):
    properties = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ''
    return f'<w:p>{properties}<w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>'


def flush_table():
    if not table:
        return
    rows = []
    for index, cells in enumerate(table):
        row = []
        for cell in cells:
            shading = '<w:shd w:fill="E2E8F0"/>' if index == 0 else ''
            row.append(f'<w:tc><w:tcPr><w:tcW w:w="2600" w:type="dxa"/>{shading}</w:tcPr>{paragraph(cell)}</w:tc>')
        rows.append('<w:tr>' + ''.join(row) + '</w:tr>')
    borders = ''.join(f'<w:{side} w:val="single" w:sz="4" w:color="CBD5E1"/>' for side in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'])
    body.append('<w:tbl><w:tblPr><w:tblW w:w="7800" w:type="dxa"/><w:tblBorders>' + borders + '</w:tblBorders></w:tblPr><w:tblGrid>' + '<w:gridCol w:w="2600"/>' * len(table[0]) + '</w:tblGrid>' + ''.join(rows) + '</w:tbl>')
    table.clear()


for line in source.read_text(encoding='utf-8').splitlines():
    if line.startswith('|'):
        if '---' not in line:
            table.append([cell.strip() for cell in line.strip('|').split('|')])
        continue
    flush_table()
    if not line:
        continue
    if line.startswith('# '):
        body.append(paragraph(line[2:], 'Title'))
    elif line.startswith('## '):
        body.append(paragraph(line[3:], 'Heading1'))
    else:
        body.append(paragraph('• ' + line[2:] if line.startswith('- ') else line))
flush_table()

ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
styles = f'''<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="{ns}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="0F172A"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="320"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/><w:spacing w:before="280" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
</w:styles>'''
document = f'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="{ns}"><w:body>' + ''.join(body) + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" w:header="500" w:footer="500"/></w:sectPr></w:body></w:document>'
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    archive.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
    archive.writestr('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    archive.writestr('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
    archive.writestr('word/document.xml', document)
    archive.writestr('word/styles.xml', styles)
