import assert from "node:assert/strict";
import { test } from "node:test";
import { CvTextExtractor } from "../src/services/cv-text-extractor.js";
import { HttpError } from "../src/utils/httpError.js";
import { cvMimeTypes } from "../src/types/cv.types.js";

function createPdf(text: string): Buffer {
  const stream = `BT /F1 14 Tf 50 700 Td (${text.replace(/[\\()]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const crossReferenceOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(fileName: string, contents: string): Buffer {
  const name = Buffer.from(fileName);
  const data = Buffer.from(contents);
  const checksum = crc32(data);
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(data.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(name.length, 26);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(data.length, 20);
  centralHeader.writeUInt32LE(data.length, 24);
  centralHeader.writeUInt16LE(name.length, 28);

  const localFile = Buffer.concat([localHeader, name, data]);
  const centralDirectory = Buffer.concat([centralHeader, name]);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(1, 8);
  endRecord.writeUInt16LE(1, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localFile.length, 16);
  return Buffer.concat([localFile, centralDirectory, endRecord]);
}

test("extracts selectable text from PDF and DOCX without executing document content", async () => {
  const extractor = new CvTextExtractor();
  const pdfText =
    "Experienced platform engineer with measurable reliability results";
  const pdf = await extractor.extract(
    createPdf(pdfText),
    cvMimeTypes.pdf,
  );
  const docx = createStoredZip(
    "word/document.xml",
    "<w:document><w:body><w:p><w:r><w:t>Led &amp; improved platform reliability across multiple production systems</w:t></w:r></w:p></w:body></w:document>",
  );
  const docxText = await extractor.extract(docx, cvMimeTypes.docx);

  assert.match(pdf, /Experienced platform engineer/);
  assert.match(docxText, /Led & improved platform reliability/);
});

test("rejects malformed or textless document input", async () => {
  const extractor = new CvTextExtractor();
  await assert.rejects(
    extractor.extract(Buffer.from("not a PDF"), cvMimeTypes.pdf),
    (error: unknown) => error instanceof HttpError && error.status === 422,
  );
  await assert.rejects(
    extractor.extract(Buffer.from("not a DOCX"), cvMimeTypes.docx),
    (error: unknown) => error instanceof HttpError && error.status === 422,
  );
});
