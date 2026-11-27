import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as yauzl from "yauzl";
import type { CvMimeType } from "../types/cv.types.js";
import { HttpError } from "../utils/httpError.js";

const MAX_EXTRACTED_TEXT_CHARS = 25_000;
const MAX_PDF_PAGES = 50;
const MAX_DOCX_XML_BYTES = 2 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 2_000;

export interface CvTextExtractorContract {
  extract(buffer: Buffer, mimeType: CvMimeType): Promise<string>;
}

function normalizeText(text: string): string {
  const withoutControls = Array.from(text)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return !(
        (codePoint >= 0 && codePoint <= 8) ||
        codePoint === 11 ||
        codePoint === 12 ||
        (codePoint >= 14 && codePoint <= 31) ||
        codePoint === 127
      );
    })
    .join("");
  return withoutControls
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_EXTRACTED_TEXT_CHARS);
}

function decodeXmlText(value: string): string {
  return value.replace(
    /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,
    (entity, valueWithoutDelimiters: string) => {
      if (valueWithoutDelimiters.startsWith("#x")) {
        const codePoint = Number.parseInt(valueWithoutDelimiters.slice(2), 16);
        return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : " ";
      }
      if (valueWithoutDelimiters.startsWith("#")) {
        const codePoint = Number.parseInt(valueWithoutDelimiters.slice(1), 10);
        return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : " ";
      }

      const entities: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
      };
      return entities[valueWithoutDelimiters] ?? entity;
    },
  );
}

function isValidCodePoint(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0x10ffff &&
    (value < 0xd800 || value > 0xdfff)
  );
}

function extractDocxXmlText(xml: string): string {
  const paragraphs = xml.replace(/<\/w:p\s*>/g, "\n");
  const pieces = Array.from(
    paragraphs.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g),
    (match) => decodeXmlText(match[1] ?? ""),
  );
  return normalizeText(pieces.join(" "));
}

async function extractDocxXml(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, autoClose: true, validateEntrySizes: true },
      (openError, zipFile) => {
        if (openError || !zipFile) {
          reject(new HttpError(422, "Teks CV DOCX tidak dapat diekstrak."));
          return;
        }

        let settled = false;
        const fail = () => {
          if (!settled) {
            settled = true;
            zipFile.close();
            reject(new HttpError(422, "Teks CV DOCX tidak dapat diekstrak."));
          }
        };

        if (zipFile.entryCount > MAX_DOCX_ENTRIES) {
          fail();
          return;
        }

        zipFile.on("error", fail);
        zipFile.on("end", fail);
        zipFile.on("entry", (entry) => {
          if (entry.fileName !== "word/document.xml") {
            zipFile.readEntry();
            return;
          }
          if (entry.isEncrypted() || entry.uncompressedSize > MAX_DOCX_XML_BYTES) {
            fail();
            return;
          }

          zipFile.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              fail();
              return;
            }

            const chunks: Buffer[] = [];
            let byteCount = 0;
            stream.on("data", (chunk: Buffer | string) => {
              const content = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              byteCount += content.length;
              if (byteCount > MAX_DOCX_XML_BYTES) {
                stream.destroy();
                fail();
                return;
              }
              chunks.push(content);
            });
            stream.on("error", fail);
            stream.on("end", () => {
              if (settled) {
                return;
              }
              settled = true;
              zipFile.close();
              resolve(Buffer.concat(chunks).toString("utf8"));
            });
          });
        });
        zipFile.readEntry();
      },
    );
  });
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    verbosity: 0,
  });

  let text: string;
  try {
    const document = await loadingTask.promise;
    if (document.numPages > MAX_PDF_PAGES) {
      throw new HttpError(422, "CV PDF melebihi batas halaman analisis.");
    }

    const pieces: string[] = [];
    let characterCount = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ("str" in item && typeof item.str === "string" && item.str.length > 0) {
          pieces.push(item.str);
          characterCount += item.str.length + 1;
          if (characterCount >= MAX_EXTRACTED_TEXT_CHARS) {
            break;
          }
        }
      }
      if (characterCount >= MAX_EXTRACTED_TEXT_CHARS) {
        break;
      }
    }
    text = normalizeText(pieces.join(" "));
  } catch (error) {
    try {
      await loadingTask.destroy();
    } catch {
      throw new HttpError(503, "Pemrosesan file CV tidak dapat ditutup dengan aman.");
    }
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(422, "Teks CV PDF tidak dapat diekstrak.");
  }
  try {
    await loadingTask.destroy();
  } catch {
    throw new HttpError(503, "Pemrosesan file CV tidak dapat ditutup dengan aman.");
  }
  return text;
}

export class CvTextExtractor implements CvTextExtractorContract {
  async extract(buffer: Buffer, mimeType: CvMimeType): Promise<string> {
    const text =
      mimeType === "application/pdf"
        ? await extractPdfText(buffer)
        : extractDocxXmlText(await extractDocxXml(buffer));
    if (text.length < 20) {
      throw new HttpError(
        422,
        "Teks CV tidak dapat diekstrak atau terlalu sedikit untuk dianalisis.",
      );
    }
    return text;
  }
}
