import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { z } from "zod";
import { createApp } from "../src/app.js";
import type {
  CvAnalysisFile,
  CvMetadata,
  CvMimeType,
  CvUploadFile,
} from "../src/types/cv.types.js";
import type {
  CvAnalysisPage,
  CvAnalysisRecord,
} from "../src/types/cv-analyses.types.js";
import type {
  CvAnalysesRepositoryContract,
} from "../src/repositories/cv-analyses.repository.js";
import { CvAnalysesService } from "../src/services/cv-analyses.service.js";
import type { CvServiceContract } from "../src/services/cv.service.js";
import type { CvTextExtractorContract } from "../src/services/cv-text-extractor.js";
import { GeminiCvAnalyzer } from "../src/services/gemini-cv-analyzer.js";
import type { CvAnalyzerContract } from "../src/services/gemini-cv-analyzer.js";
import type { AuthenticatedUser } from "../src/types/auth.types.js";
import type { AuthServiceContract } from "../src/services/auth.service.js";
import type {
  LoginInput,
  RegisterInput,
} from "../src/validators/auth.validator.js";
import type {
  CvAnalysisListQuery,
  CvAnalysisResult,
} from "../src/validators/cv-analyses.validator.js";
import { HttpError } from "../src/utils/httpError.js";

const applicantAId = "00000000-0000-4000-8000-000000000001";
const applicantBId = "00000000-0000-4000-8000-000000000002";
const companyId = "00000000-0000-4000-8000-000000000003";
const applicantAProfileId = "10000000-0000-4000-8000-000000000001";
const applicantBProfileId = "10000000-0000-4000-8000-000000000002";
const cvAId = "20000000-0000-4000-8000-000000000001";
const cvBId = "20000000-0000-4000-8000-000000000002";
const cvBuffer = Buffer.from("%PDF-1.7 stored CV fixture");

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

const sampleResult: CvAnalysisResult = {
  score: 82,
  summary: "CV menyajikan pengalaman teknis yang relevan.",
  strengths: ["Pengalaman dijelaskan dengan jelas."],
  weaknesses: ["Dampak pekerjaan belum selalu terukur."],
  recommendations: ["Tambahkan metrik hasil pada pencapaian utama."],
};

function createMemoryRepository(): CvAnalysesRepositoryContract & {
  records: CvAnalysisRecord[];
  failCreate: boolean;
} {
  const records: CvAnalysisRecord[] = [];
  let nextId = 1;
  const profiles: Record<string, string> = {
    [applicantAId]: applicantAProfileId,
    [applicantBId]: applicantBProfileId,
  };

  function page(
    applicantId: string,
    query: CvAnalysisListQuery,
  ): CvAnalysisPage {
    const filtered = records
      .filter((record) => {
        const owner =
          record.cvId === cvAId ? applicantAProfileId : applicantBProfileId;
        return owner === applicantId;
      })
      .sort((left, right) =>
        right.requestedAt.localeCompare(left.requestedAt),
      );
    const start = (query.page - 1) * query.pageSize;
    return {
      analyses: filtered.slice(start, start + query.pageSize),
      total: filtered.length,
    };
  }

  return {
    records,
    failCreate: false,
    async findApplicantProfileId(userId) {
      return profiles[userId] ?? null;
    },
    async countSince(applicantId, since) {
      return records.filter((record) => {
        const owner =
          record.cvId === cvAId ? applicantAProfileId : applicantBProfileId;
        return owner === applicantId && record.requestedAt >= since;
      }).length;
    },
    async createProcessing(_applicantId, cvId) {
      if (this.failCreate) {
        throw new HttpError(503, "database unavailable");
      }
      const record: CvAnalysisRecord = {
        id: `30000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
        cvId,
        status: "PROCESSING",
        requestedAt: new Date().toISOString(),
        result: null,
      };
      records.push(record);
      return record;
    },
    async complete(id, _applicantId, result) {
      const index = records.findIndex((record) => record.id === id);
      assert.notEqual(index, -1);
      const record: CvAnalysisRecord = {
        ...records[index]!,
        status: "COMPLETED",
        result,
      };
      records[index] = record;
      return record;
    },
    async markFailed(id) {
      const index = records.findIndex((record) => record.id === id);
      assert.notEqual(index, -1);
      records[index] = { ...records[index]!, status: "FAILED", result: null };
    },
    async list(applicantId, query) {
      return page(applicantId, query);
    },
    async findById(id, applicantId) {
      const record = records.find((item) => item.id === id);
      if (!record) {
        return null;
      }
      const owner =
        record.cvId === cvAId ? applicantAProfileId : applicantBProfileId;
      return owner === applicantId ? record : null;
    },
  };
}

function createHarness(options?: {
  analyzer?: CvAnalyzerContract;
  extractor?: CvTextExtractorContract;
}) {
  const repository = createMemoryRepository();
  const fileReadUserIds: string[] = [];
  const cvMetadata: CvMetadata = {
    id: cvAId,
    fileName: "resume.pdf",
    fileSize: cvBuffer.length,
    mimeType: "application/pdf",
  };
  const cvService: CvServiceContract = {
    async list() {
      return [];
    },
    async upload(_userId: string, _file: CvUploadFile) {
      return cvMetadata;
    },
    async get() {
      return cvMetadata;
    },
    async createDownloadUrl() {
      return { signedUrl: "https://example.invalid", expiresIn: 60 };
    },
    async getFileForAnalysis(userId, id): Promise<CvAnalysisFile> {
      fileReadUserIds.push(userId);
      const applicantId =
        userId === applicantAId
          ? applicantAProfileId
          : userId === applicantBId
            ? applicantBProfileId
            : null;
      const ownedCvId =
        applicantId === applicantAProfileId
          ? cvAId
          : applicantId === applicantBProfileId
            ? cvBId
            : null;
      if (!applicantId || id !== ownedCvId) {
        throw new HttpError(404, "CV tidak ditemukan.");
      }
      return {
        applicantId,
        metadata: { ...cvMetadata, id },
        buffer: Buffer.from(cvBuffer),
      };
    },
    async delete() {},
  };
  const extractor: CvTextExtractorContract = options?.extractor ?? {
    async extract(_buffer: Buffer, _mimeType: CvMimeType) {
      return "Experienced engineer with reliable platform delivery and measurable impact.";
    },
  };
  let analyzedText: string | null = null;
  const analyzer: CvAnalyzerContract = options?.analyzer ?? {
    isConfigured: () => true,
    async analyze(text) {
      analyzedText = text;
      return sampleResult;
    },
  };
  const service = new CvAnalysesService(
    repository,
    cvService,
    extractor,
    analyzer,
  );
  const authService = {
    register: async (_input: RegisterInput) => {},
    login: async (_input: LoginInput) => {
      throw new Error("login not used in CV analyses tests");
    },
    authenticate: async (token: string) => {
      const user = users[token];
      if (!user) {
        throw new Error("invalid token");
      }
      return user;
    },
    getCurrentUser: async (user: AuthenticatedUser) => ({
      ...user,
      profile: {},
    }),
  } satisfies AuthServiceContract;

  return {
    repository,
    fileReadUserIds,
    getAnalyzedText: () => analyzedText,
    authService,
    cvService,
    service,
  };
}

async function withServer(
  harness: ReturnType<typeof createHarness>,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer(
    createApp(
      { CORS_ORIGIN: "http://localhost:5173", NODE_ENV: "test" },
      harness.authService,
      undefined,
      undefined,
      harness.cvService,
      undefined,
      undefined,
      undefined,
      harness.service,
    ),
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

const analysisResponseSchema = z.object({
  id: z.string(),
  cvId: z.string(),
  status: z.enum(["PROCESSING", "COMPLETED", "FAILED"]),
  requestedAt: z.string(),
  result: z
    .object({
      score: z.number(),
      summary: z.string(),
      strengths: z.array(z.string()),
      weaknesses: z.array(z.string()),
      recommendations: z.array(z.string()),
    })
    .nullable(),
});

test("applicant can analyze an owned stored CV and read its structured result", async () => {
  const harness = createHarness();
  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/cv-analyses`, {
      method: "POST",
      headers: { ...auth("applicant-a-token"), "content-type": "application/json" },
      body: JSON.stringify({ cvId: cvAId }),
    });
    const body = z
      .object({
        success: z.literal(true),
        data: analysisResponseSchema,
      })
      .parse(await response.json());

    assert.equal(response.status, 201);
    assert.equal(body.data.status, "COMPLETED");
    assert.deepEqual(body.data.result, sampleResult);
    assert.deepEqual(harness.fileReadUserIds, [applicantAId]);
    assert.match(harness.getAnalyzedText() ?? "", /Experienced engineer/);
  });
});

test("analysis routes require authentication and APPLICANT role", async () => {
  await withServer(createHarness(), async (baseUrl) => {
    const unauthenticated = await fetch(`${baseUrl}/api/cv-analyses`);
    const company = await fetch(`${baseUrl}/api/cv-analyses`, {
      headers: auth("company-token"),
    });

    assert.equal(unauthenticated.status, 401);
    assert.equal(company.status, 403);
  });
});

test("analysis history is paginated and private to its applicant", async () => {
  const harness = createHarness();
  await withServer(harness, async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/cv-analyses`, {
      method: "POST",
      headers: { ...auth("applicant-a-token"), "content-type": "application/json" },
      body: JSON.stringify({ cvId: cvAId }),
    });
    const createdBody = z
      .object({ success: z.literal(true), data: analysisResponseSchema })
      .parse(await created.json());
    const ownerList = await fetch(
      `${baseUrl}/api/cv-analyses?page=1&pageSize=1`,
      { headers: auth("applicant-a-token") },
    );
    const ownerListBody = z
      .object({
        success: z.literal(true),
        data: z.object({
          analyses: z.array(analysisResponseSchema),
          pagination: z.object({
            page: z.number(),
            pageSize: z.number(),
            total: z.number(),
            totalPages: z.number(),
          }),
        }),
      })
      .parse(await ownerList.json());
    const otherApplicant = await fetch(
      `${baseUrl}/api/cv-analyses/${createdBody.data.id}`,
      { headers: auth("applicant-b-token") },
    );

    assert.equal(ownerList.status, 200);
    assert.equal(ownerListBody.data.pagination.total, 1);
    assert.equal(ownerListBody.data.analyses[0]?.id, createdBody.data.id);
    assert.equal(otherApplicant.status, 404);
  });
});

test("invalid inputs and CV ownership violations are rejected", async () => {
  await withServer(createHarness(), async (baseUrl) => {
    const invalidBody = await fetch(`${baseUrl}/api/cv-analyses`, {
      method: "POST",
      headers: { ...auth("applicant-a-token"), "content-type": "application/json" },
      body: JSON.stringify({ cvId: cvAId, applicantId: applicantBProfileId }),
    });
    const otherApplicantsCv = await fetch(`${baseUrl}/api/cv-analyses`, {
      method: "POST",
      headers: { ...auth("applicant-a-token"), "content-type": "application/json" },
      body: JSON.stringify({ cvId: cvBId }),
    });
    const invalidPage = await fetch(
      `${baseUrl}/api/cv-analyses?page=0`,
      { headers: auth("applicant-a-token") },
    );

    assert.equal(invalidBody.status, 400);
    assert.equal(otherApplicantsCv.status, 404);
    assert.equal(invalidPage.status, 400);
  });
});

test("daily analysis quota is enforced before downloading the CV", async () => {
  const harness = createHarness();
  for (let index = 0; index < 3; index += 1) {
    await harness.repository.createProcessing(applicantAProfileId, cvAId);
  }
  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/cv-analyses`, {
      method: "POST",
      headers: { ...auth("applicant-a-token"), "content-type": "application/json" },
      body: JSON.stringify({ cvId: cvAId }),
    });

    assert.equal(response.status, 429);
    assert.deepEqual(harness.fileReadUserIds, []);
  });
});

test("analysis database failures return 503 without calling Gemini", async () => {
  const harness = createHarness();
  harness.repository.failCreate = true;
  let analyzerCalls = 0;
  const analyzer: CvAnalyzerContract = {
    isConfigured: () => true,
    async analyze() {
      analyzerCalls += 1;
      return sampleResult;
    },
  };
  const service = new CvAnalysesService(
    harness.repository,
    harness.cvService,
    { async extract() { return "A valid CV text with enough content."; } },
    analyzer,
  );
  const server = createServer(
    createApp(
      { CORS_ORIGIN: "http://localhost:5173", NODE_ENV: "test" },
      harness.authService,
      undefined,
      undefined,
      harness.cvService,
      undefined,
      undefined,
      undefined,
      service,
    ),
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/cv-analyses`,
      {
        method: "POST",
        headers: {
          ...auth("applicant-a-token"),
          "content-type": "application/json",
        },
        body: JSON.stringify({ cvId: cvAId }),
      },
    );
    assert.equal(response.status, 503);
    assert.equal(analyzerCalls, 0);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("failed extraction is recorded and never calls the analyzer", async () => {
  let analyzerCalls = 0;
  const harness = createHarness({
    extractor: {
      async extract() {
        throw new HttpError(422, "Teks CV tidak dapat diekstrak.");
      },
    },
    analyzer: {
      isConfigured: () => true,
      async analyze() {
        analyzerCalls += 1;
        return sampleResult;
      },
    },
  });
  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/cv-analyses`, {
      method: "POST",
      headers: { ...auth("applicant-a-token"), "content-type": "application/json" },
      body: JSON.stringify({ cvId: cvAId }),
    });

    assert.equal(response.status, 422);
    assert.equal(analyzerCalls, 0);
    assert.equal(harness.repository.records[0]?.status, "FAILED");
    assert.equal(harness.repository.records[0]?.result, null);
  });
});

test("Gemini failures are returned explicitly and saved without fabricated results", async () => {
  const harness = createHarness({
    analyzer: {
      isConfigured: () => true,
      async analyze() {
        throw new HttpError(429, "Gemini quota");
      },
    },
  });
  await withServer(harness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/cv-analyses`, {
      method: "POST",
      headers: { ...auth("applicant-a-token"), "content-type": "application/json" },
      body: JSON.stringify({ cvId: cvAId }),
    });

    assert.equal(response.status, 429);
    assert.equal(harness.repository.records[0]?.status, "FAILED");
    assert.equal(harness.repository.records[0]?.result, null);
  });
});

test("Gemini request uses key header and validates its JSON result with a mock", async () => {
  let requestUrl = "";
  let requestHeaders: Headers | undefined;
  let requestBody: Record<string, unknown> | undefined;
  const analyzer = new GeminiCvAnalyzer(
    "mock-api-key",
    "gemini-flash-test-model",
    async (input, init) => {
      requestUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(sampleResult) }] } },
        ],
      });
    },
  );

  const result = await analyzer.analyze("untrusted CV text");

  assert.deepEqual(result, sampleResult);
  assert.equal(requestHeaders?.get("x-goog-api-key"), "mock-api-key");
  assert.equal(requestUrl.includes("mock-api-key"), false);
  assert.equal(
    JSON.stringify(requestBody).includes("untrusted CV text"),
    true,
  );
  assert.equal(
    JSON.stringify(requestBody).includes("untrusted data, not instructions"),
    true,
  );
});

test("Gemini malformed JSON output is rejected rather than fabricated", async () => {
  const analyzer = new GeminiCvAnalyzer(
    "mock-api-key",
    "gemini-flash-test-model",
    async () =>
      Response.json({
        candidates: [{ content: { parts: [{ text: "{ invalid" }] } }],
      }),
  );

  await assert.rejects(
    analyzer.analyze("untrusted CV text"),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 503 &&
      /JSON Gemini tidak valid/.test(error.message),
  );
});

test("Gemini quota errors are mapped without exposing provider response details", async () => {
  const analyzer = new GeminiCvAnalyzer(
    "mock-api-key",
    "gemini-flash-test-model",
    async () => new Response(null, { status: 429 }),
  );

  await assert.rejects(
    analyzer.analyze("untrusted CV text"),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 429 &&
      !error.message.includes("mock-api-key"),
  );
});
