import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { z } from "zod";
import { createApp } from "../src/app.js";
import type { ApplicationsRepositoryContract } from "../src/repositories/applications.repository.js";
import { toApplicationHttpError } from "../src/repositories/applications.repository.js";
import type {
  ApplicationPage,
  ApplicationRecord,
  ApplicationStatus,
  SubmittedApplication,
} from "../src/types/applications.types.js";
import type { AuthenticatedUser } from "../src/types/auth.types.js";
import type { AuthServiceContract } from "../src/services/auth.service.js";
import { ApplicationsService } from "../src/services/applications.service.js";
import type { ApplicationListQuery } from "../src/validators/applications.validator.js";
import type { LoginInput, RegisterInput } from "../src/validators/auth.validator.js";
import { HttpError } from "../src/utils/httpError.js";

const applicantAUserId = "00000000-0000-4000-8000-000000000001";
const applicantBUserId = "00000000-0000-4000-8000-000000000002";
const companyAUserId = "00000000-0000-4000-8000-000000000003";
const companyBUserId = "00000000-0000-4000-8000-000000000004";
const applicantAProfileId = "10000000-0000-4000-8000-000000000001";
const applicantBProfileId = "10000000-0000-4000-8000-000000000002";
const companyAId = "20000000-0000-4000-8000-000000000001";
const companyBId = "20000000-0000-4000-8000-000000000002";
const jobAId = "30000000-0000-4000-8000-000000000001";
const jobBId = "30000000-0000-4000-8000-000000000002";
const cvAId = "40000000-0000-4000-8000-000000000001";
const cvBId = "40000000-0000-4000-8000-000000000002";
const applicationAId = "50000000-0000-4000-8000-000000000001";
const applicationBId = "50000000-0000-4000-8000-000000000002";

const users: Record<string, AuthenticatedUser> = {
  "applicant-a-token": {
    id: applicantAUserId,
    email: "applicant-a@example.com",
    fullName: "Applicant A",
    role: "APPLICANT",
    accountStatus: "ACTIVE",
  },
  "applicant-b-token": {
    id: applicantBUserId,
    email: "applicant-b@example.com",
    fullName: "Applicant B",
    role: "APPLICANT",
    accountStatus: "ACTIVE",
  },
  "company-a-token": {
    id: companyAUserId,
    email: "company-a@example.com",
    fullName: "Company A",
    role: "COMPANY",
    accountStatus: "ACTIVE",
  },
  "company-b-token": {
    id: companyBUserId,
    email: "company-b@example.com",
    fullName: "Company B",
    role: "COMPANY",
    accountStatus: "ACTIVE",
  },
};

const errorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  errors: z.null(),
});

function createMemoryRepository(): ApplicationsRepositoryContract & {
  applications: ApplicationRecord[];
  submissions: SubmittedApplication[];
  missNextStatusUpdate: boolean;
  seedApplication(
    id: string,
    applicantId: string,
    jobId: string,
    status?: ApplicationStatus,
  ): ApplicationRecord;
} {
  const jobs = [
    {
      id: jobAId,
      companyId: companyAId,
      title: "Backend Engineer",
      employmentType: "FULL_TIME",
      location: "Jakarta",
      deadline: "2099-12-31",
      companyName: "Company A",
      status: "ACTIVE",
    },
    {
      id: jobBId,
      companyId: companyBId,
      title: "Platform Engineer",
      employmentType: "REMOTE",
      location: "Remote",
      deadline: "2099-12-31",
      companyName: "Company B",
      status: "ACTIVE",
    },
    {
      id: "30000000-0000-4000-8000-000000000003",
      companyId: companyAId,
      title: "Draft Role",
      employmentType: null,
      location: null,
      deadline: "2099-12-31",
      companyName: "Company A",
      status: "DRAFT",
    },
    {
      id: "30000000-0000-4000-8000-000000000004",
      companyId: companyAId,
      title: "Expired Role",
      employmentType: null,
      location: null,
      deadline: "2000-01-01",
      companyName: "Company A",
      status: "ACTIVE",
    },
  ];
  const applicantProfiles: Record<string, string> = {
    [applicantAUserId]: applicantAProfileId,
    [applicantBUserId]: applicantBProfileId,
  };
  const companyProfiles: Record<string, string> = {
    [companyAUserId]: companyAId,
    [companyBUserId]: companyBId,
  };
  const applicantNames: Record<string, string> = {
    [applicantAProfileId]: "Applicant A",
    [applicantBProfileId]: "Applicant B",
  };
  const cvs = [
    {
      id: cvAId,
      applicantId: applicantAProfileId,
      fileName: "applicant-a.pdf",
      fileSize: 1024,
      mimeType: "application/pdf" as const,
    },
    {
      id: cvBId,
      applicantId: applicantBProfileId,
      fileName: "applicant-b.docx",
      fileSize: 2048,
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const,
    },
  ];
  const applications: ApplicationRecord[] = [];
  const submissions: SubmittedApplication[] = [];
  let missNextStatusUpdate = false;

  function makeApplication(
    id: string,
    applicantId: string,
    jobId: string,
    status: ApplicationStatus,
    documentId: string,
    coverLetter: string | null = null,
  ): ApplicationRecord {
    const job = jobs.find((item) => item.id === jobId);
    const document = cvs.find((item) => item.id === documentId);
    assert.ok(job && document);
    return {
      id,
      applicantId,
      jobId,
      coverLetter,
      status,
      submittedAt: new Date().toISOString(),
      job: {
        id: job.id,
        title: job.title,
        employmentType: job.employmentType,
        location: job.location,
        deadline: job.deadline,
        companyName: job.companyName,
      },
      documents: [
        {
          id: document.id,
          fileName: document.fileName,
          fileSize: document.fileSize,
          mimeType: document.mimeType,
        },
      ],
      applicant: {
        fullName: applicantNames[applicantId],
        headline: "Software Engineer",
      },
    };
  }

  function page(
    rows: ApplicationRecord[],
    query: ApplicationListQuery,
  ): ApplicationPage {
    const filtered = query.status
      ? rows.filter((application) => application.status === query.status)
      : rows;
    const start = (query.page - 1) * query.pageSize;
    return {
      applications: filtered.slice(start, start + query.pageSize),
      total: filtered.length,
    };
  }

  const repository = {
    applications,
    submissions,
    get missNextStatusUpdate() {
      return missNextStatusUpdate;
    },
    set missNextStatusUpdate(value: boolean) {
      missNextStatusUpdate = value;
    },
    seedApplication(
      id: string,
      applicantId: string,
      jobId: string,
      status: ApplicationStatus = "TERKIRIM",
    ) {
      const cv = cvs.find((item) => item.applicantId === applicantId);
      assert.ok(cv);
      const application = makeApplication(id, applicantId, jobId, status, cv.id);
      applications.push(application);
      return application;
    },
    async findApplicantProfileId(userId: string) {
      return applicantProfiles[userId] ?? null;
    },
    async findCompanyProfileId(userId: string) {
      return companyProfiles[userId] ?? null;
    },
    async submitApplication(
      input: { applicantId: string; jobId: string; cvId: string; coverLetter?: string | null },
    ) {
      const job = jobs.find((item) => item.id === input.jobId);
      if (!job) {
        throw toApplicationHttpError({ code: "P0002" });
      }
      if (job.status !== "ACTIVE") {
        throw toApplicationHttpError({
          code: "23514",
          message: "Applications can only be submitted to active jobs.",
        });
      }
      const today = new Date().toISOString().slice(0, 10);
      if (job.deadline !== null && job.deadline < today) {
        throw toApplicationHttpError({
          code: "23514",
          message: "The job application deadline has passed.",
        });
      }
      const cv = cvs.find(
        (item) =>
          item.id === input.cvId && item.applicantId === input.applicantId,
      );
      if (!cv) {
        throw toApplicationHttpError({ code: "P0002" });
      }
      if (
        applications.some(
          (application) =>
            application.applicantId === input.applicantId &&
            application.jobId === input.jobId,
        )
      ) {
        throw toApplicationHttpError({
          code: "23505",
          constraint: "applications_applicant_job_unique",
        });
      }

      const application = makeApplication(
        randomUUID(),
        input.applicantId,
        input.jobId,
        "TERKIRIM",
        cv.id,
        input.coverLetter ?? null,
      );
      applications.push(application);
      const submitted: SubmittedApplication = {
        id: application.id,
        applicantId: application.applicantId,
        jobId: application.jobId,
        coverLetter: application.coverLetter,
        status: application.status,
        submittedAt: application.submittedAt,
        documentId: cv.id,
      };
      submissions.push(submitted);
      return submitted;
    },
    async listApplicantApplications(
      applicantId: string,
      query: ApplicationListQuery,
    ) {
      const rows = applications
        .filter((application) => application.applicantId === applicantId)
        .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
      return page(rows, query);
    },
    async findApplicantApplication(id: string, applicantId: string) {
      return (
        applications.find(
          (application) =>
            application.id === id && application.applicantId === applicantId,
        ) ?? null
      );
    },
    async listCompanyApplications(
      companyId: string,
      query: ApplicationListQuery,
    ) {
      const jobIds = new Set(
        jobs.filter((job) => job.companyId === companyId).map((job) => job.id),
      );
      const rows = applications
        .filter((application) => jobIds.has(application.jobId))
        .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
      return page(rows, query);
    },
    async findCompanyApplication(id: string, companyId: string) {
      return (
        applications.find(
          (application) =>
            application.id === id &&
            jobs.some(
              (job) =>
                job.id === application.jobId && job.companyId === companyId,
            ),
        ) ?? null
      );
    },
    async updateCompanyApplicationStatus(
      id: string,
      jobId: string,
      expectedStatus: ApplicationStatus,
      nextStatus: ApplicationStatus,
    ) {
      if (missNextStatusUpdate) {
        missNextStatusUpdate = false;
        return null;
      }
      const application = applications.find(
        (item) =>
          item.id === id &&
          item.jobId === jobId &&
          item.status === expectedStatus,
      );
      if (!application) {
        return null;
      }
      application.status = nextStatus;
      return application;
    },
  };
  return repository;
}

async function withApplicationsServer(
  callback: (
    baseUrl: string,
    repository: ReturnType<typeof createMemoryRepository>,
  ) => Promise<void>,
): Promise<void> {
  const repository = createMemoryRepository();
  const authService = {
    register: async (_input: RegisterInput) => {},
    login: async (_input: LoginInput) => {
      throw new Error("login not used in applications tests");
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
  const app = createApp(
    { CORS_ORIGIN: "http://localhost:5173", NODE_ENV: "test" },
    authService,
    undefined,
    undefined,
    undefined,
    new ApplicationsService(repository),
  );
  const server = createServer(app);
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

function jsonRequest(
  token: string,
  method: string,
  body?: unknown,
): RequestInit {
  return {
    method,
    headers: {
      ...auth(token),
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

test("applicant submits a CV-backed application using JWT ownership", async () => {
  await withApplicationsServer(async (baseUrl, repository) => {
    const response = await fetch(
      `${baseUrl}/api/applications`,
      jsonRequest("applicant-a-token", "POST", {
        jobId: jobAId,
        cvId: cvAId,
        coverLetter: "I am interested in this role.",
      }),
    );
    const body = z
      .object({
        success: z.literal(true),
        data: z.object({
          id: z.string(),
          jobId: z.string(),
          cvId: z.string(),
          coverLetter: z.string(),
          status: z.literal("TERKIRIM"),
          submittedAt: z.string(),
        }),
      })
      .parse(await response.json());

    assert.equal(response.status, 201);
    assert.equal(body.data.jobId, jobAId);
    assert.equal(body.data.cvId, cvAId);
    assert.equal(repository.submissions[0]?.applicantId, applicantAProfileId);
    assert.equal("storageKey" in body.data, false);
  });
});

test("submission validates input, rejects duplicate jobs, and maps database constraints", async () => {
  await withApplicationsServer(async (baseUrl, repository) => {
    const invalid = await fetch(
      `${baseUrl}/api/applications`,
      jsonRequest("applicant-a-token", "POST", {
        jobId: jobAId,
        cvId: cvAId,
        applicantId: applicantBProfileId,
      }),
    );
    assert.equal(invalid.status, 400);

    const first = await fetch(
      `${baseUrl}/api/applications`,
      jsonRequest("applicant-a-token", "POST", {
        jobId: jobAId,
        cvId: cvAId,
      }),
    );
    const duplicate = await fetch(
      `${baseUrl}/api/applications`,
      jsonRequest("applicant-a-token", "POST", {
        jobId: jobAId,
        cvId: cvAId,
      }),
    );
    assert.equal(first.status, 201);
    assert.equal(duplicate.status, 409);
    assert.equal(repository.applications.length, 1);
  });

  assert.equal(
    toApplicationHttpError({
      code: "23505",
      message: 'duplicate key violates constraint "applications_applicant_job_unique"',
    }).status,
    409,
  );
  assert.equal(
    toApplicationHttpError({
      code: "23505",
      constraint: "unrelated_unique_constraint",
    }).status,
    503,
  );
  assert.equal(toApplicationHttpError({ code: "08006" }).status, 503);
});

test("submission rejects inactive and expired jobs and CVs owned by another applicant", async () => {
  await withApplicationsServer(async (baseUrl) => {
    const inactiveJob = "30000000-0000-4000-8000-000000000003";
    const expiredJob = "30000000-0000-4000-8000-000000000004";
    const inactive = await fetch(
      `${baseUrl}/api/applications`,
      jsonRequest("applicant-a-token", "POST", {
        jobId: inactiveJob,
        cvId: cvAId,
      }),
    );
    const expired = await fetch(
      `${baseUrl}/api/applications`,
      jsonRequest("applicant-a-token", "POST", {
        jobId: expiredJob,
        cvId: cvAId,
      }),
    );
    const foreignCv = await fetch(
      `${baseUrl}/api/applications`,
      jsonRequest("applicant-a-token", "POST", {
        jobId: jobAId,
        cvId: cvBId,
      }),
    );
    assert.equal(inactive.status, 409);
    assert.equal(expired.status, 409);
    assert.equal(foreignCv.status, 404);
  });

  assert.equal(
    toApplicationHttpError({
      code: "23514",
      message: "Applications can only be submitted to active jobs.",
    }).status,
    409,
  );
  assert.equal(
    toApplicationHttpError({
      code: "23514",
      message: "The job application deadline has passed.",
    }).status,
    409,
  );
});

test("application routes require authentication and the correct role", async () => {
  await withApplicationsServer(async (baseUrl) => {
    const anonymous = await fetch(`${baseUrl}/api/applications`);
    const companySubmit = await fetch(
      `${baseUrl}/api/applications`,
      jsonRequest("company-a-token", "POST", {
        jobId: jobAId,
        cvId: cvAId,
      }),
    );
    const applicantCompanyList = await fetch(
      `${baseUrl}/api/company/applications`,
      { headers: auth("applicant-a-token") },
    );
    const applicantStatusUpdate = await fetch(
      `${baseUrl}/api/company/applications/${applicationAId}/status`,
      jsonRequest("applicant-a-token", "PATCH", { status: "DITINJAU" }),
    );

    assert.equal(anonymous.status, 401);
    assert.equal(companySubmit.status, 403);
    assert.equal(applicantCompanyList.status, 403);
    assert.equal(applicantStatusUpdate.status, 403);
    errorResponseSchema.parse(await applicantStatusUpdate.json());
  });
});

test("applicant history is paginated and detail is restricted to its owner", async () => {
  await withApplicationsServer(async (baseUrl, repository) => {
    repository.seedApplication(
      applicationAId,
      applicantAProfileId,
      jobAId,
    );
    repository.seedApplication(
      applicationBId,
      applicantBProfileId,
      jobBId,
    );

    const list = await fetch(
      `${baseUrl}/api/applications?page=1&pageSize=1`,
      { headers: auth("applicant-a-token") },
    );
    const invalidPagination = await fetch(
      `${baseUrl}/api/applications?page=0`,
      { headers: auth("applicant-a-token") },
    );
    const invalidStatusFilter = await fetch(
      `${baseUrl}/api/company/applications?status=UNKNOWN`,
      { headers: auth("company-a-token") },
    );
    const listBody = z
      .object({
        success: z.literal(true),
        data: z.object({
          applications: z.array(
            z.object({
              id: z.string(),
              cvDocuments: z.array(
                z.object({
                  id: z.string(),
                  fileSize: z.number(),
                  mimeType: z.string(),
                }),
              ),
            }),
          ),
          pagination: z.object({
            page: z.number(),
            pageSize: z.number(),
            total: z.number(),
            totalPages: z.number(),
          }),
        }),
      })
      .parse(await list.json());
    const ownDetail = await fetch(
      `${baseUrl}/api/applications/${applicationAId}`,
      { headers: auth("applicant-a-token") },
    );
    const otherDetail = await fetch(
      `${baseUrl}/api/applications/${applicationBId}`,
      { headers: auth("applicant-a-token") },
    );

    assert.equal(list.status, 200);
    assert.equal(invalidPagination.status, 400);
    assert.equal(invalidStatusFilter.status, 400);
    assert.equal(listBody.data.applications.length, 1);
    assert.equal(listBody.data.pagination.total, 1);
    assert.equal(listBody.data.pagination.totalPages, 1);
    assert.equal(ownDetail.status, 200);
    assert.equal(otherDetail.status, 404);
    assert.equal(JSON.stringify(listBody).includes("storageKey"), false);
    assert.equal(JSON.stringify(listBody).includes("fileName"), false);
  });
});

test("company lists, reads, and updates only applications for its own jobs", async () => {
  await withApplicationsServer(async (baseUrl, repository) => {
    repository.seedApplication(
      applicationAId,
      applicantAProfileId,
      jobAId,
    );
    repository.seedApplication(
      applicationBId,
      applicantBProfileId,
      jobBId,
    );

    const list = await fetch(
      `${baseUrl}/api/company/applications?page=1&pageSize=10`,
      { headers: auth("company-a-token") },
    );
    const listBody = z
      .object({
        success: z.literal(true),
        data: z.object({
          applications: z.array(
            z.object({
              id: z.string(),
              applicant: z.object({ fullName: z.string() }),
              cvDocuments: z.array(
                z.object({
                  id: z.string(),
                  fileSize: z.number(),
                  mimeType: z.string(),
                }),
              ),
            }),
          ),
        }),
      })
      .parse(await list.json());
    const ownDetail = await fetch(
      `${baseUrl}/api/company/applications/${applicationAId}`,
      { headers: auth("company-a-token") },
    );
    const foreignDetail = await fetch(
      `${baseUrl}/api/company/applications/${applicationBId}`,
      { headers: auth("company-a-token") },
    );
    const foreignUpdate = await fetch(
      `${baseUrl}/api/company/applications/${applicationBId}/status`,
      jsonRequest("company-a-token", "PATCH", { status: "DITINJAU" }),
    );

    assert.equal(list.status, 200);
    assert.deepEqual(
      listBody.data.applications.map((application) => application.id),
      [applicationAId],
    );
    assert.equal(ownDetail.status, 200);
    assert.equal(foreignDetail.status, 404);
    assert.equal(foreignUpdate.status, 404);
    assert.equal(JSON.stringify(listBody).includes("storageKey"), false);
    assert.equal(JSON.stringify(listBody).includes("fileName"), false);
  });
});

test("company status transitions are validated and conditional updates reject races", async () => {
  await withApplicationsServer(async (baseUrl, repository) => {
    repository.seedApplication(
      applicationAId,
      applicantAProfileId,
      jobAId,
    );
    const invalidTransition = await fetch(
      `${baseUrl}/api/company/applications/${applicationAId}/status`,
      jsonRequest("company-a-token", "PATCH", { status: "DITERIMA" }),
    );
    assert.equal(invalidTransition.status, 409);

    const invalidInput = await fetch(
      `${baseUrl}/api/company/applications/${applicationAId}/status`,
      jsonRequest("company-a-token", "PATCH", { status: "NOT_A_STATUS" }),
    );
    assert.equal(invalidInput.status, 400);

    const validTransition = await fetch(
      `${baseUrl}/api/company/applications/${applicationAId}/status`,
      jsonRequest("company-a-token", "PATCH", { status: "DITINJAU" }),
    );
    assert.equal(validTransition.status, 200);

    const interviewTransition = await fetch(
      `${baseUrl}/api/company/applications/${applicationAId}/status`,
      jsonRequest("company-a-token", "PATCH", { status: "WAWANCARA" }),
    );
    assert.equal(interviewTransition.status, 200);

    const accepted = await fetch(
      `${baseUrl}/api/company/applications/${applicationAId}/status`,
      jsonRequest("company-a-token", "PATCH", { status: "DITERIMA" }),
    );
    assert.equal(accepted.status, 200);

    const terminalTransition = await fetch(
      `${baseUrl}/api/company/applications/${applicationAId}/status`,
      jsonRequest("company-a-token", "PATCH", { status: "DITOLAK" }),
    );
    assert.equal(terminalTransition.status, 409);

    repository.seedApplication(
      applicationBId,
      applicantBProfileId,
      jobAId,
    );
    repository.missNextStatusUpdate = true;
    const racedUpdate = await fetch(
      `${baseUrl}/api/company/applications/${applicationBId}/status`,
      jsonRequest("company-a-token", "PATCH", { status: "DITINJAU" }),
    );
    assert.equal(racedUpdate.status, 409);
  });
});
