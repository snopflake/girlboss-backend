import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import * as yauzl from "yauzl";
import type {
  CreateCvDocumentInput,
  CvRepositoryContract,
} from "../repositories/cv.repository.js";
import type {
  CvDocumentRecord,
  CvMetadata,
  CvMimeType,
  CvUploadFile,
} from "../types/cv.types.js";
import { HttpError } from "../utils/httpError.js";
import { cvUploadMetadataSchema } from "../validators/cv.validator.js";

export const DEFAULT_CV_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_CV_MAX_PER_APPLICANT = 5;
export const CV_SIGNED_URL_TTL_SECONDS = 60;

export interface CvServiceOptions {
  maxFileSizeBytes: number;
  maxPerApplicant: number;
}

export interface CvDownload {
  signedUrl: string;
  expiresIn: number;
}

export interface CvServiceContract {
  list(userId: string): Promise<CvMetadata[]>;
  upload(userId: string, file: CvUploadFile): Promise<CvMetadata>;
  get(userId: string, id: string): Promise<CvMetadata>;
  createDownloadUrl(userId: string, id: string): Promise<CvDownload>;
  delete(userId: string, id: string): Promise<void>;
}

const mimeByExtension: Record<string, CvMimeType> = {
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function toMetadata(document: CvDocumentRecord): CvMetadata {
  return {
    id: document.id,
    fileName: document.fileName,
    fileSize: document.fileSize,
    mimeType: document.mimeType,
  };
}

function normalizedFileName(originalName: string): string {
  const fileName = originalName.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  const parsed = cvUploadMetadataSchema.shape.fileName.safeParse(fileName);
  if (!parsed.success) {
    throw new HttpError(400, "Nama file CV tidak valid.");
  }
  return parsed.data;
}

function hasPdfSignature(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

async function isDocxPackage(buffer: Buffer): Promise<boolean> {
  if (
    buffer.length < 4 ||
    !buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  ) {
    return false;
  }

  return new Promise((resolve) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, autoClose: true },
      (error, zipFile) => {
        if (error || !zipFile || zipFile.entryCount > 2_000) {
          zipFile?.close();
          resolve(false);
          return;
        }

        let hasContentTypes = false;
        let hasDocumentXml = false;
        let completed = false;
        const finish = (isValid: boolean) => {
          if (!completed) {
            completed = true;
            resolve(isValid);
          }
        };

        zipFile.on("error", () => finish(false));
        zipFile.on("end", () =>
          finish(hasContentTypes && hasDocumentXml),
        );
        zipFile.on("close", () =>
          finish(hasContentTypes && hasDocumentXml),
        );
        zipFile.on("entry", (entry) => {
          if (entry.isEncrypted()) {
            zipFile.close();
            finish(false);
            return;
          }
          if (entry.fileName === "[Content_Types].xml") {
            hasContentTypes = true;
          }
          if (entry.fileName === "word/document.xml") {
            hasDocumentXml = true;
          }
          zipFile.readEntry();
        });
        zipFile.readEntry();
      },
    );
  });
}

export class CvService implements CvServiceContract {
  constructor(
    private readonly repository: CvRepositoryContract,
    private readonly options: CvServiceOptions,
  ) {}

  async list(userId: string): Promise<CvMetadata[]> {
    const applicantId = await this.getApplicantId(userId);
    const documents = await this.repository.listApplicantDocuments(applicantId);
    return documents.map(toMetadata);
  }

  async upload(userId: string, file: CvUploadFile): Promise<CvMetadata> {
    const fileName = normalizedFileName(file.originalName);
    const extension = extname(fileName).toLowerCase();
    const mimeType = mimeByExtension[extension];
    if (!mimeType || file.mimeType !== mimeType) {
      throw new HttpError(400, "CV harus berupa file PDF atau DOCX yang valid.");
    }

    const parsedMetadata = cvUploadMetadataSchema.safeParse({
      fileName,
      mimeType,
      fileSize: file.buffer.length,
    });
    if (!parsedMetadata.success || file.buffer.length === 0) {
      throw new HttpError(400, "File CV tidak valid.");
    }
    if (file.buffer.length > this.options.maxFileSizeBytes) {
      throw new HttpError(413, "Ukuran file CV melebihi batas.");
    }

    const hasValidSignature =
      mimeType === "application/pdf"
        ? hasPdfSignature(file.buffer)
        : await isDocxPackage(file.buffer);
    if (!hasValidSignature) {
      throw new HttpError(400, "Signature file tidak sesuai dengan format CV.");
    }

    const applicantId = await this.getApplicantId(userId);
    const count = await this.repository.countApplicantDocuments(applicantId);
    if (count >= this.options.maxPerApplicant) {
      throw new HttpError(409, "Jumlah CV maksimum untuk akun ini sudah tercapai.");
    }

    const storageKey = `${applicantId}/cvs/${randomUUID()}${extension}`;
    const input: CreateCvDocumentInput = {
      applicantId,
      fileName,
      fileSize: file.buffer.length,
      mimeType,
      storageKey,
    };

    try {
      await this.repository.uploadObject(storageKey, file.buffer, mimeType);
      const document = await this.repository.createDocument(input);
      return toMetadata(document);
    } catch (error) {
      try {
        await this.repository.removeObject(storageKey);
      } catch {
        throw new HttpError(
          503,
          "CV gagal disimpan dan file sementara tidak dapat dibersihkan.",
        );
      }
      throw error;
    }
  }

  async get(userId: string, id: string): Promise<CvMetadata> {
    const document = await this.getOwnedDocument(userId, id);
    return toMetadata(document);
  }

  async createDownloadUrl(userId: string, id: string): Promise<CvDownload> {
    const document = await this.getOwnedDocument(userId, id);
    const signedUrl = await this.repository.createSignedDownloadUrl(
      document.storageKey,
      CV_SIGNED_URL_TTL_SECONDS,
    );
    return { signedUrl, expiresIn: CV_SIGNED_URL_TTL_SECONDS };
  }

  async delete(userId: string, id: string): Promise<void> {
    const document = await this.getOwnedDocument(userId, id);
    const linkCount = await this.repository.countDocumentApplicationLinks(id);
    if (linkCount > 0) {
      throw new HttpError(
        409,
        "CV tidak dapat dihapus karena masih digunakan oleh lamaran.",
      );
    }

    const analysisCount =
      await this.repository.countDocumentAnalyses(document.id);
    if (analysisCount > 0) {
      throw new HttpError(
        409,
        "CV tidak dapat dihapus karena masih direferensikan oleh analisis.",
      );
    }

    const deleted = await this.repository.deleteDocument(id, document.applicantId);
    if (!deleted) {
      throw new HttpError(404, "CV tidak ditemukan.");
    }
    try {
      await this.repository.removeObject(document.storageKey);
    } catch (error) {
      try {
        await this.repository.restoreDocument(document);
      } catch {
        throw new HttpError(
          503,
          "File CV gagal dihapus dan metadata tidak dapat dipulihkan.",
        );
      }
      throw error;
    }
  }

  private async getApplicantId(userId: string): Promise<string> {
    const applicantId =
      await this.repository.findApplicantProfileId(userId);
    if (!applicantId) {
      throw new HttpError(404, "Profil applicant tidak ditemukan.");
    }
    return applicantId;
  }

  private async getOwnedDocument(
    userId: string,
    id: string,
  ): Promise<CvDocumentRecord> {
    const applicantId = await this.getApplicantId(userId);
    const document = await this.repository.findApplicantDocument(id, applicantId);
    if (!document) {
      throw new HttpError(404, "CV tidak ditemukan.");
    }
    return document;
  }
}
