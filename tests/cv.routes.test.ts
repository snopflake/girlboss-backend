import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import type { CvRepositoryContract } from "../src/repositories/cv.repository.js";
import { toCvDeleteHttpError } from "../src/repositories/cv.repository.js";
import { CvService } from "../src/services/cv.service.js";
import type { AuthServiceContract } from "../src/services/auth.service.js";
import type { AuthenticatedUser } from "../src/types/auth.types.js";
import type {
  CvDocumentRecord,
  CvMimeType,
} from "../src/types/cv.types.js";
import type { CreateCvDocumentInput } from "../src/repositories/cv.repository.js";
import type {
  LoginInput,
  RegisterInput,
} from "../src/validators/auth.validator.js";
import { HttpError } from "../src/utils/httpError.js";
import { z } from "zod";

const applicantAId = "00000000-0000-4000-8000-000000000001";
const applicantBId = "00000000-0000-4000-8000-000000000002";
const applicantProfileAId = "10000000-0000-4000-8000-000000000001";
const applicantProfileBId = "10000000-0000-4000-8000-000000000002";
const companyId = "00000000-0000-4000-8000-000000000003";
const cvAId = "20000000-0000-4000-8000-000000000001";
const cvBId = "20000000-0000-4000-8000-000000000002";
const pdfMimeType = "application/pdf";
const docxMimeType =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const minimalDocxBase64 =
  "UEsDBBQAAAAIAFq9e13HHBc8CgAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLMJqSxILda3AwBQSwMEFAAAAAgAWr17XV9b0UwNAAAACwAAABEAAAB3b3JkL2RvY3VtZW50LnhtbLNJyU8uzU3NK9G3AwBQSwECFAAUAAAACABavXtdxxwXPAoAAAAIAAAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUABQAAAAIAFq9e11fW9FMDQAAAAsAAAARAAAAAAAAAAAAAACAATsAAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAgACAIAAAAB3AAAAAAA=";

const users: Record<string, AuthenticatedUser> = {
  "applicant-a-token": {
    id: applicantAId,
    email: "applicant-a@example.com",
    fullName: "Applicant A",
    role: "APPLICANT",
    accountStatus: "ACTIVE",
  },
  "applicant-b-token": {
    id: applicantBId,
    email: "applicant-b@example.com",
    fullName: "Applicant B",
    role: "APPLICANT",
    accountStatus: "ACTIVE",
  },
  "company-token": {
    id: companyId,
    email: "company@example.com",
    fullName: "Company",
    role: "COMPANY",
    accountStatus: "ACTIVE",
  },
};

function makeDocument(
  id: string,
  applicantId: string,
  values: Partial<CvDocumentRecord> = {},
): CvDocumentRecord {
  return {
    id,
    applicantId,
    fileName: "resume.pdf",
    fileSize: 24,
    mimeType: pdfMimeType,
    storageKey: `${applicantId}/cvs/${id}.pdf`,
    ...values,
  };
}

function createMemoryCvRepository(): CvRepositoryContract & {
  documents: Map<string, CvDocumentRecord>;
  objects: Map<string, Buffer>;
  linkedDocumentIds: Set<string>;
  analyzedDocumentIds: Set<string>;
  removedKeys: string[];
  signedUrlExpirations: number[];
  failUpload: boolean;
  failInsert: boolean;
  failCleanup: boolean;
  deleteError: HttpError | null;
} {
  const documents = new Map<string, CvDocumentRecord>();
  const objects = new Map<string, Buffer>();
  const linkedDocumentIds = new Set<string>();
  const analyzedDocumentIds = new Set<string>();
  const removedKeys: string[] = [];
  const signedUrlExpirations: number[] = [];
  let nextId = 3;
  const repository = {
    documents,
    objects,
    linkedDocumentIds,
    analyzedDocumentIds,
    removedKeys,
    signedUrlExpirations,
    failUpload: false,
    failInsert: false,
    failCleanup: false,
    deleteError: null,
    async findApplicantProfileId(userId: string) {
      if (userId === applicantAId) return applicantProfileAId;
      if (userId === applicantBId) return applicantProfileBId;
      return null;
    },
    async listApplicantDocuments(applicantId: string) {
      return [...documents.values()]
        .filter(
          (document) =>
            document.applicantId === applicantId &&
            document.storageKey.startsWith(`${applicantId}/cvs/`),
        )
        .map((document) => ({ ...document }));
    },
    async countApplicantDocuments(applicantId: string) {
      return [...documents.values()].filter(
        (document) =>
          document.applicantId === applicantId &&
          document.storageKey.startsWith(`${applicantId}/cvs/`),
      ).length;
    },
    async createDocument(input: CreateCvDocumentInput) {
      if (repository.failInsert) {
        throw new HttpError(503, "Metadata CV tidak dapat disimpan.");
      }
      const document = makeDocument(
        `20000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
        input.applicantId,
        {
          fileName: input.fileName,
          fileSize: input.fileSize,
          mimeType: input.mimeType,
          storageKey: input.storageKey,
        },
      );
      documents.set(document.id, document);
      return { ...document };
    },
    async findApplicantDocument(id: string, applicantId: string) {
      const document = documents.get(id);
      return document?.applicantId === applicantId &&
        document.storageKey.startsWith(`${applicantId}/cvs/`)
        ? { ...document }
        : null;
    },
    async countDocumentApplicationLinks(documentId: string) {
      return linkedDocumentIds.has(documentId) ? 1 : 0;
    },
    async countDocumentAnalyses(documentId: string) {
      return analyzedDocumentIds.has(documentId) ? 1 : 0;
    },
    async deleteDocument(id: string, applicantId: string) {
      if (repository.deleteError) {
        throw repository.deleteError;
      }
      const document = documents.get(id);
      if (
        !document ||
        document.applicantId !== applicantId ||
        !document.storageKey.startsWith(`${applicantId}/cvs/`)
      ) {
        return false;
      }
      documents.delete(id);
      return true;
    },
    async restoreDocument(document: CvDocumentRecord) {
      documents.set(document.id, { ...document });
    },
    async uploadObject(
      storageKey: string,
      file: Buffer,
      _mimeType: CvMimeType,
    ) {
      if (repository.failUpload) {
        throw new HttpError(503, "File CV tidak dapat diunggah.");
      }
      objects.set(storageKey, Buffer.from(file));
    },
    async downloadObject(storageKey: string) {
      const file = objects.get(storageKey);
      if (!file) {
        throw new HttpError(503, "File CV tidak dapat diambil untuk analisis.");
      }
      return Buffer.from(file);
    },
    async removeObject(storageKey: string) {
      removedKeys.push(storageKey);
      if (repository.failCleanup) {
        throw new HttpError(503, "File CV tidak dapat dihapus dari Storage.");
      }
      objects.delete(storageKey);
    },
    async createSignedDownloadUrl(
      storageKey: string,
      expiresInSeconds: number,
    ) {
      signedUrlExpirations.push(expiresInSeconds);
      return `https://storage.example/signed/${encodeURIComponent(storageKey)}?token=temporary`;
    },
  };

  documents.set(cvAId, makeDocument(cvAId, applicantProfileAId));
  documents.set(cvBId, makeDocument(cvBId, applicantProfileBId));
  objects.set(
    `${applicantProfileAId}/cvs/${cvAId}.pdf`,
    Buffer.from("%PDF-1.7 test"),
  );
  objects.set(
    `${applicantProfileBId}/cvs/${cvBId}.pdf`,
    Buffer.from("%PDF-1.7 test"),
  );
  return repository;
}

async function withCvServer(
  callback: (
    baseUrl: string,
    repository: ReturnType<typeof createMemoryCvRepository>,
  ) => Promise<void>,
  options: { maxFileSizeBytes?: number; maxPerApplicant?: number } = {},
): Promise<void> {
  const repository = createMemoryCvRepository();
  const authService = {
    register: async (_input: RegisterInput) => {},
    login: async (_input: LoginInput) => {
      throw new Error("login not used in CV tests");
    },
    authenticate: async (token: string) => {
      const user = users[token];
      if (!user) {
        throw new HttpError(401, "Token tidak valid atau telah kedaluwarsa.");
      }
      return user;
    },
    getCurrentUser: async (user: AuthenticatedUser) => ({
      ...user,
      profile: {},
    }),
  } satisfies AuthServiceContract;
  const maxFileSizeBytes = options.maxFileSizeBytes ?? 10 * 1024 * 1024;
  const maxPerApplicant = options.maxPerApplicant ?? 5;
  const server = createServer(
    createApp(
      {
        CORS_ORIGIN: "http://localhost:5173",
        NODE_ENV: "test",
        CV_MAX_FILE_SIZE_BYTES: maxFileSizeBytes,
        CV_MAX_PER_APPLICANT: maxPerApplicant,
      },
      authService,
      undefined,
      undefined,
      new CvService(repository, { maxFileSizeBytes, maxPerApplicant }),
    ),
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await callback(`http://127.0.0.1:${address.port}`, repository);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function uploadForm(
  bytes: Buffer,
  fileName: string,
  mimeType: string,
): FormData {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: mimeType }),
    fileName,
  );
  return form;
}

const metadataResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.record(z.string(), z.unknown()),
});

test("applicant can upload PDF and DOCX with validated metadata", async () => {
  await withCvServer(async (baseUrl, repository) => {
    const pdfResponse = await fetch(`${baseUrl}/api/applicant/cvs`, {
      method: "POST",
      headers: auth("applicant-a-token"),
      body: uploadForm(Buffer.from("%PDF-1.7 example"), "resume.pdf", pdfMimeType),
    });
    const pdfBody = metadataResponseSchema.parse(await pdfResponse.json());
    assert.equal(pdfResponse.status, 201);
    assert.deepEqual(pdfBody.data, {
      id: "20000000-0000-4000-8000-000000000003",
      fileName: "resume.pdf",
      fileSize: Buffer.byteLength("%PDF-1.7 example"),
      mimeType: pdfMimeType,
    });
    assert.equal("storageKey" in pdfBody.data, false);

    const docxResponse = await fetch(`${baseUrl}/api/applicant/cvs`, {
      method: "POST",
      headers: auth("applicant-a-token"),
      body: uploadForm(
        Buffer.from(minimalDocxBase64, "base64"),
        "resume.docx",
        docxMimeType,
      ),
    });
    const docxBody = metadataResponseSchema.parse(await docxResponse.json());
    assert.equal(docxResponse.status, 201);
    assert.equal(docxBody.data.fileName, "resume.docx");
    assert.equal(docxBody.data.mimeType, docxMimeType);
    assert.equal(repository.documents.size, 4);
    assert.equal(repository.objects.size, 4);
  });
});

test("upload rejects unsupported, mismatched, and invalid-signature files", async () => {
  await withCvServer(async (baseUrl) => {
    const unsupported = await fetch(`${baseUrl}/api/applicant/cvs`, {
      method: "POST",
      headers: auth("applicant-a-token"),
      body: uploadForm(Buffer.from("data"), "resume.txt", "text/plain"),
    });
    const mismatched = await fetch(`${baseUrl}/api/applicant/cvs`, {
      method: "POST",
      headers: auth("applicant-a-token"),
      body: uploadForm(Buffer.from("%PDF-1.7 example"), "resume.docx", pdfMimeType),
    });
    const invalidSignature = await fetch(`${baseUrl}/api/applicant/cvs`, {
      method: "POST",
      headers: auth("applicant-a-token"),
      body: uploadForm(Buffer.from("not a PDF"), "resume.pdf", pdfMimeType),
    });

    assert.equal(unsupported.status, 400);
    assert.equal(mismatched.status, 400);
    assert.equal(invalidSignature.status, 400);
  });
});

test("upload requires an authenticated APPLICANT and one file within the configured limit", async () => {
  await withCvServer(
    async (baseUrl) => {
      const unauthenticated = await fetch(`${baseUrl}/api/applicant/cvs`, {
        method: "POST",
        body: uploadForm(Buffer.from("%PDF-1.7"), "resume.pdf", pdfMimeType),
      });
      const wrongRole = await fetch(`${baseUrl}/api/applicant/cvs`, {
        method: "POST",
        headers: auth("company-token"),
        body: uploadForm(Buffer.from("%PDF-1.7"), "resume.pdf", pdfMimeType),
      });
      const tooLarge = await fetch(`${baseUrl}/api/applicant/cvs`, {
        method: "POST",
        headers: auth("applicant-a-token"),
        body: uploadForm(Buffer.from("%PDF-1.7 too large"), "resume.pdf", pdfMimeType),
      });

      assert.equal(unauthenticated.status, 401);
      assert.equal(wrongRole.status, 403);
      assert.equal(tooLarge.status, 413);
    },
    { maxFileSizeBytes: 10 },
  );
});

test("list, metadata, and download only expose the current applicant's CVs", async () => {
  await withCvServer(async (baseUrl, repository) => {
    const otherDocument = makeDocument(
      "20000000-0000-4000-8000-000000000003",
      applicantProfileAId,
      {
        fileName: "other-document.pdf",
        storageKey: `${applicantProfileAId}/documents/other-document.pdf`,
      },
    );
    repository.documents.set(otherDocument.id, otherDocument);

    const listResponse = await fetch(`${baseUrl}/api/applicant/cvs`, {
      headers: auth("applicant-a-token"),
    });
    const listBody = metadataResponseSchema.parse(await listResponse.json());
    assert.equal(listResponse.status, 200);
    assert.deepEqual(listBody.data.cvs, [
      {
        id: cvAId,
        fileName: "resume.pdf",
        fileSize: 24,
        mimeType: pdfMimeType,
      },
    ]);

    const metadataResponse = await fetch(
      `${baseUrl}/api/applicant/cvs/${cvAId}`,
      { headers: auth("applicant-a-token") },
    );
    const metadataBody = metadataResponseSchema.parse(
      await metadataResponse.json(),
    );
    assert.equal(metadataResponse.status, 200);
    assert.equal(metadataBody.data.id, cvAId);

    const foreignMetadata = await fetch(
      `${baseUrl}/api/applicant/cvs/${cvBId}`,
      { headers: auth("applicant-a-token") },
    );
    const foreignDownload = await fetch(
      `${baseUrl}/api/applicant/cvs/${cvBId}/download`,
      { headers: auth("applicant-a-token") },
    );
    assert.equal(foreignMetadata.status, 404);
    assert.equal(foreignDownload.status, 404);

    const downloadResponse = await fetch(
      `${baseUrl}/api/applicant/cvs/${cvAId}/download`,
      { headers: auth("applicant-a-token") },
    );
    const downloadBody = metadataResponseSchema.parse(
      await downloadResponse.json(),
    );
    assert.equal(downloadResponse.status, 200);
    assert.equal(downloadBody.data.expiresIn, 60);
    assert.match(String(downloadBody.data.signedUrl), /^https:\/\/storage\.example\/signed\//);
    assert.equal(repository.signedUrlExpirations[0], 60);
    assert.equal("storageKey" in downloadBody.data, false);
  });
});

test("another applicant cannot delete a CV and the owner can delete an unlinked CV", async () => {
  await withCvServer(async (baseUrl, repository) => {
    const foreignDelete = await fetch(
      `${baseUrl}/api/applicant/cvs/${cvBId}`,
      { method: "DELETE", headers: auth("applicant-a-token") },
    );
    assert.equal(foreignDelete.status, 404);
    assert.equal(repository.objects.has(`${applicantProfileBId}/cvs/${cvBId}.pdf`), true);

    const deleteResponse = await fetch(
      `${baseUrl}/api/applicant/cvs/${cvAId}`,
      { method: "DELETE", headers: auth("applicant-a-token") },
    );
    assert.equal(deleteResponse.status, 200);
    assert.equal(repository.documents.has(cvAId), false);
    assert.equal(repository.objects.has(`${applicantProfileAId}/cvs/${cvAId}.pdf`), false);
  });
});

test("CV deletion is blocked while referenced by an application", async () => {
  await withCvServer(async (baseUrl, repository) => {
    repository.linkedDocumentIds.add(cvAId);
    const response = await fetch(`${baseUrl}/api/applicant/cvs/${cvAId}`, {
      method: "DELETE",
      headers: auth("applicant-a-token"),
    });
    assert.equal(response.status, 409);
    assert.equal(repository.documents.has(cvAId), true);
    assert.equal(repository.objects.has(`${applicantProfileAId}/cvs/${cvAId}.pdf`), true);
    assert.deepEqual(repository.removedKeys, []);
  });
});

test("CV deletion is blocked while referenced by a CV analysis", async () => {
  await withCvServer(async (baseUrl, repository) => {
    repository.analyzedDocumentIds.add(cvAId);
    const response = await fetch(`${baseUrl}/api/applicant/cvs/${cvAId}`, {
      method: "DELETE",
      headers: auth("applicant-a-token"),
    });
    assert.equal(response.status, 409);
    assert.equal(repository.documents.has(cvAId), true);
    assert.equal(repository.objects.has(`${applicantProfileAId}/cvs/${cvAId}.pdf`), true);
    assert.deepEqual(repository.removedKeys, []);
  });
});

test("only known CV reference foreign keys map to delete conflicts", () => {
  const applicationLinkError = toCvDeleteHttpError({
    code: "23503",
    constraint: "application_document_links_document_id_fkey",
  });
  const analysisLinkError = toCvDeleteHttpError({
    code: "23503",
    details: 'Key (id) is still referenced from table "cv_analyses".',
  });
  const unrelatedForeignKeyError = toCvDeleteHttpError({
    code: "23503",
    constraint: "unrelated_document_reference_fkey",
  });
  const nonForeignKeyError = toCvDeleteHttpError({
    code: "08006",
    details: 'table "cv_analyses"',
  });

  assert.equal(applicationLinkError.status, 409);
  assert.equal(analysisLinkError.status, 409);
  assert.equal(unrelatedForeignKeyError.status, 503);
  assert.equal(nonForeignKeyError.status, 503);
});

test("a database reference conflict leaves the CV file in Storage", async () => {
  await withCvServer(async (baseUrl, repository) => {
    repository.deleteError = toCvDeleteHttpError({
      code: "23503",
      constraint: "application_document_links_document_id_fkey",
    });

    const response = await fetch(`${baseUrl}/api/applicant/cvs/${cvAId}`, {
      method: "DELETE",
      headers: auth("applicant-a-token"),
    });

    assert.equal(response.status, 409);
    assert.equal(repository.documents.has(cvAId), true);
    assert.equal(repository.objects.has(`${applicantProfileAId}/cvs/${cvAId}.pdf`), true);
    assert.deepEqual(repository.removedKeys, []);
  });
});

test("failed Storage deletion restores its metadata", async () => {
  await withCvServer(async (baseUrl, repository) => {
    repository.failCleanup = true;
    const response = await fetch(`${baseUrl}/api/applicant/cvs/${cvAId}`, {
      method: "DELETE",
      headers: auth("applicant-a-token"),
    });
    assert.equal(response.status, 503);
    assert.equal(repository.documents.has(cvAId), true);
    assert.equal(repository.objects.has(`${applicantProfileAId}/cvs/${cvAId}.pdf`), true);
  });
});

test("failed storage upload and failed metadata insert are surfaced and compensated", async () => {
  await withCvServer(async (baseUrl, repository) => {
    repository.failUpload = true;
    const uploadFailure = await fetch(`${baseUrl}/api/applicant/cvs`, {
      method: "POST",
      headers: auth("applicant-a-token"),
      body: uploadForm(Buffer.from("%PDF-1.7 example"), "resume.pdf", pdfMimeType),
    });
    assert.equal(uploadFailure.status, 503);
    assert.equal(repository.documents.size, 2);

    repository.failUpload = false;
    repository.failInsert = true;
    const metadataFailure = await fetch(`${baseUrl}/api/applicant/cvs`, {
      method: "POST",
      headers: auth("applicant-a-token"),
      body: uploadForm(Buffer.from("%PDF-1.7 example"), "resume.pdf", pdfMimeType),
    });
    assert.equal(metadataFailure.status, 503);
    assert.equal(repository.documents.size, 2);
    assert.equal(repository.objects.size, 2);
    assert.equal(repository.removedKeys.length, 2);
  });
});

test("failed upload compensation is surfaced instead of returning success", async () => {
  await withCvServer(async (baseUrl, repository) => {
    repository.failInsert = true;
    repository.failCleanup = true;
    const response = await fetch(`${baseUrl}/api/applicant/cvs`, {
      method: "POST",
      headers: auth("applicant-a-token"),
      body: uploadForm(Buffer.from("%PDF-1.7 example"), "resume.pdf", pdfMimeType),
    });
    const body = z
      .object({ success: z.boolean(), message: z.string() })
      .parse(await response.json());
    assert.equal(response.status, 503);
    assert.equal(body.success, false);
    assert.match(body.message, /tidak dapat dibersihkan/);
  });
});

test("maximum CV count is enforced per applicant", async () => {
  await withCvServer(
    async (baseUrl, repository) => {
      const response = await fetch(`${baseUrl}/api/applicant/cvs`, {
        method: "POST",
        headers: auth("applicant-a-token"),
        body: uploadForm(Buffer.from("%PDF-1.7 example"), "resume.pdf", pdfMimeType),
      });
      assert.equal(response.status, 409);
      assert.equal(repository.objects.size, 2);
    },
    { maxPerApplicant: 1 },
  );
});

test("analysis file retrieval downloads only the current applicant's private CV", async () => {
  const repository = createMemoryCvRepository();
  const sourceBuffer = Buffer.from("%PDF-1.7 test");
  const storedDocument = repository.documents.get(cvAId);
  assert.ok(storedDocument);
  repository.documents.set(cvAId, {
    ...storedDocument,
    fileSize: sourceBuffer.length,
  });
  repository.objects.set(storedDocument.storageKey, sourceBuffer);
  const service = new CvService(repository, {
    maxFileSizeBytes: 10 * 1024 * 1024,
    maxPerApplicant: 5,
  });

  const source = await service.getFileForAnalysis(applicantAId, cvAId);

  assert.equal(source.applicantId, applicantProfileAId);
  assert.equal(source.metadata.id, cvAId);
  assert.deepEqual(source.buffer, sourceBuffer);
  await assert.rejects(
    service.getFileForAnalysis(applicantAId, cvBId),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
});
