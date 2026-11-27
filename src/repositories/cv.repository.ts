import { getSupabaseAdminClient } from "../config/supabaseAdmin.js";
import type {
  CvDocumentRecord,
  CvMimeType,
} from "../types/cv.types.js";
import { HttpError } from "../utils/httpError.js";

export const cvStorageBucket = "applicant-documents";

function cvStorageKeyPattern(applicantId: string): string {
  return `${applicantId}/cvs/%`;
}

export interface CreateCvDocumentInput {
  applicantId: string;
  fileName: string;
  fileSize: number;
  mimeType: CvMimeType;
  storageKey: string;
}

export interface CvRepositoryContract {
  findApplicantProfileId(userId: string): Promise<string | null>;
  listApplicantDocuments(applicantId: string): Promise<CvDocumentRecord[]>;
  countApplicantDocuments(applicantId: string): Promise<number>;
  createDocument(input: CreateCvDocumentInput): Promise<CvDocumentRecord>;
  findApplicantDocument(
    id: string,
    applicantId: string,
  ): Promise<CvDocumentRecord | null>;
  countDocumentApplicationLinks(documentId: string): Promise<number>;
  countDocumentAnalyses(documentId: string): Promise<number>;
  deleteDocument(id: string, applicantId: string): Promise<boolean>;
  restoreDocument(document: CvDocumentRecord): Promise<void>;
  uploadObject(
    storageKey: string,
    file: Buffer,
    mimeType: CvMimeType,
  ): Promise<void>;
  downloadObject(storageKey: string): Promise<Buffer>;
  removeObject(storageKey: string): Promise<void>;
  createSignedDownloadUrl(
    storageKey: string,
    expiresInSeconds: number,
  ): Promise<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toCvDocumentRecord(value: unknown): CvDocumentRecord {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.applicant_id !== "string" ||
    typeof value.file_name !== "string" ||
    typeof value.file_size !== "number" ||
    !Number.isSafeInteger(value.file_size) ||
    (value.mime_type !== "application/pdf" &&
      value.mime_type !==
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document") ||
    typeof value.storage_key !== "string"
  ) {
    throw new HttpError(503, "Metadata CV tidak valid.");
  }

  return {
    id: value.id,
    applicantId: value.applicant_id,
    fileName: value.file_name,
    fileSize: value.file_size,
    mimeType: value.mime_type,
    storageKey: value.storage_key,
  };
}

function throwDatabaseError(message: string): never {
  throw new HttpError(503, message);
}

export function toCvDeleteHttpError(error: unknown): HttpError {
  if (
    isRecord(error) &&
    error.code === "23503" &&
    [error.constraint, error.details, error.message].some(
      (value) =>
        typeof value === "string" &&
        /(application_document_links|cv_analyses)/i.test(value),
    )
  ) {
    return new HttpError(
      409,
      "CV tidak dapat dihapus karena masih direferensikan oleh lamaran atau analisis.",
    );
  }

  return new HttpError(503, "Metadata CV tidak dapat dihapus.");
}

async function executeDatabaseRequest<T>(
  createRequest: () => PromiseLike<T>,
  errorMessage: string,
): Promise<T> {
  try {
    return await createRequest();
  } catch {
    throwDatabaseError(errorMessage);
  }
}

const cvColumns =
  "id, applicant_id, file_name, file_size, mime_type, storage_key";

export class SupabaseCvRepository implements CvRepositoryContract {
  async findApplicantProfileId(userId: string): Promise<string | null> {
    const { data, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("applicant_profiles")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle(),
      "Profil applicant tidak dapat diperiksa.",
    );
    if (error || (data !== null && (!isRecord(data) || typeof data.id !== "string"))) {
      throwDatabaseError("Profil applicant tidak dapat diperiksa.");
    }
    return data ? data.id : null;
  }

  async listApplicantDocuments(
    applicantId: string,
  ): Promise<CvDocumentRecord[]> {
    const { data, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("application_documents")
          .select(cvColumns)
          .eq("applicant_id", applicantId)
          .like("storage_key", cvStorageKeyPattern(applicantId))
          .order("id", { ascending: true }),
      "Daftar CV tidak dapat diambil.",
    );
    if (error || !Array.isArray(data)) {
      throwDatabaseError("Daftar CV tidak dapat diambil.");
    }
    return data.map(toCvDocumentRecord);
  }

  async countApplicantDocuments(applicantId: string): Promise<number> {
    const { count, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("application_documents")
          .select("id", { count: "exact", head: true })
          .eq("applicant_id", applicantId)
          .like("storage_key", cvStorageKeyPattern(applicantId)),
      "Jumlah CV tidak dapat diperiksa.",
    );
    if (error || count === null) {
      throwDatabaseError("Jumlah CV tidak dapat diperiksa.");
    }
    return count;
  }

  async createDocument(
    input: CreateCvDocumentInput,
  ): Promise<CvDocumentRecord> {
    const { data, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("application_documents")
          .insert({
            applicant_id: input.applicantId,
            file_name: input.fileName,
            file_size: input.fileSize,
            mime_type: input.mimeType,
            storage_key: input.storageKey,
          })
          .select(cvColumns)
          .single(),
      "Metadata CV tidak dapat disimpan.",
    );
    if (error || !data) {
      throwDatabaseError("Metadata CV tidak dapat disimpan.");
    }
    return toCvDocumentRecord(data);
  }

  async findApplicantDocument(
    id: string,
    applicantId: string,
  ): Promise<CvDocumentRecord | null> {
    const { data, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("application_documents")
          .select(cvColumns)
          .eq("id", id)
          .eq("applicant_id", applicantId)
          .like("storage_key", cvStorageKeyPattern(applicantId))
          .maybeSingle(),
      "Metadata CV tidak dapat diambil.",
    );
    if (error) {
      throwDatabaseError("Metadata CV tidak dapat diambil.");
    }
    return data ? toCvDocumentRecord(data) : null;
  }

  async countDocumentApplicationLinks(documentId: string): Promise<number> {
    const { count, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("application_document_links")
          .select("application_id", { count: "exact", head: true })
          .eq("document_id", documentId),
      "Referensi lamaran CV tidak dapat diperiksa.",
    );
    if (error || count === null) {
      throwDatabaseError("Referensi lamaran CV tidak dapat diperiksa.");
    }
    return count;
  }

  async countDocumentAnalyses(documentId: string): Promise<number> {
    const { count, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("cv_analyses")
          .select("id", { count: "exact", head: true })
          .eq("document_id", documentId),
      "Referensi analisis CV tidak dapat diperiksa.",
    );
    if (error || count === null) {
      throwDatabaseError("Referensi analisis CV tidak dapat diperiksa.");
    }
    return count;
  }

  async deleteDocument(id: string, applicantId: string): Promise<boolean> {
    const { data, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("application_documents")
          .delete()
          .eq("id", id)
          .eq("applicant_id", applicantId)
          .like("storage_key", cvStorageKeyPattern(applicantId))
          .select("id")
          .maybeSingle(),
      "Metadata CV tidak dapat dihapus.",
    );
    if (error) {
      throw toCvDeleteHttpError(error);
    }
    return data !== null;
  }

  async restoreDocument(document: CvDocumentRecord): Promise<void> {
    const { error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("application_documents")
          .insert({
            id: document.id,
            applicant_id: document.applicantId,
            file_name: document.fileName,
            file_size: document.fileSize,
            mime_type: document.mimeType,
            storage_key: document.storageKey,
          })
          .select("id")
          .single(),
      "Metadata CV yang dihapus tidak dapat dipulihkan.",
    );
    if (error) {
      throwDatabaseError("Metadata CV yang dihapus tidak dapat dipulihkan.");
    }
  }

  async uploadObject(
    storageKey: string,
    file: Buffer,
    mimeType: CvMimeType,
  ): Promise<void> {
    try {
      const { error } = await getSupabaseAdminClient()
        .storage.from(cvStorageBucket)
        .upload(storageKey, file, { contentType: mimeType, upsert: false });
      if (error) {
        throw new HttpError(503, "File CV tidak dapat diunggah.");
      }
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(503, "File CV tidak dapat diunggah.");
    }
  }

  async downloadObject(storageKey: string): Promise<Buffer> {
    try {
      const { data, error } = await getSupabaseAdminClient()
        .storage.from(cvStorageBucket)
        .download(storageKey);
      if (error || !data) {
        throw new HttpError(503, "File CV tidak dapat diambil untuk analisis.");
      }
      return Buffer.from(await data.arrayBuffer());
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(503, "File CV tidak dapat diambil untuk analisis.");
    }
  }

  async removeObject(storageKey: string): Promise<void> {
    try {
      const { error } = await getSupabaseAdminClient()
        .storage.from(cvStorageBucket)
        .remove([storageKey]);
      if (error) {
        throw new HttpError(503, "File CV tidak dapat dihapus dari Storage.");
      }
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(503, "File CV tidak dapat dihapus dari Storage.");
    }
  }

  async createSignedDownloadUrl(
    storageKey: string,
    expiresInSeconds: number,
  ): Promise<string> {
    try {
      const { data, error } = await getSupabaseAdminClient()
        .storage.from(cvStorageBucket)
        .createSignedUrl(storageKey, expiresInSeconds);
      if (error || !data?.signedUrl) {
        throw new HttpError(503, "Link unduhan CV tidak dapat dibuat.");
      }
      return data.signedUrl;
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(503, "Link unduhan CV tidak dapat dibuat.");
    }
  }
}
