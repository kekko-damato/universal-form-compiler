import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Minimal DOCX: a zip with [Content_Types].xml, _rels/.rels, word/document.xml
// We'll use a tiny pure-JS zip by constructing it manually.
// Simpler alternative: use `jszip` from node_modules (mammoth depends on it).
const JSZip = require('jszip');

const zip = new JSZip();
zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);

zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Nome: Antonio</w:t></w:r></w:p>
    <w:p><w:r><w:t>Cognome: Rossi</w:t></w:r></w:p>
    <w:p><w:r><w:t>Email: antonio.rossi@example.com</w:t></w:r></w:p>
    <w:p><w:r><w:t>Partita IVA: 12345678901</w:t></w:r></w:p>
  </w:body>
</w:document>`);

const buf = await zip.generateAsync({ type: 'nodebuffer' });
writeFileSync('tests/fixtures/sample.docx', buf);
console.log('wrote tests/fixtures/sample.docx');
