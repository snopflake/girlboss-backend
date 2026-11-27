import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { z } from "zod";
import { createApp } from "../src/app.js";
import type { SavedJobsRepositoryContract } from "../src/repositories/saved-jobs.repository.js";
import { toSavedJobDatabaseHttpError } from "../src/repositories/saved-jobs.repository.js";
import type { AuthenticatedUser } from "../src/types/auth.types.js";
import type { JobStatus } from "../src/types/jobs.types.js";
import type { SavedJobPage } from "../src/types/saved-jobs.types.js";
import type { AuthServiceContract } from "../src/services/auth.service.js";
import { SavedJobsService } from "../src/services/saved-jobs.service.js";
import type { SavedJobListQuery } from "../src/validators/saved-jobs.validator.js";
import type { LoginInput, RegisterInput } from "../src/validators/auth.validator.js";
import { HttpError } from "../src/utils/httpError.js";

const applicantAUserId = "00000000-0000-4000-8000-000000000001";
const applicantBUserId = "00000000-0000-4000-8000-000000000002";
const companyUserId = "00000000-0000-4000-8000-000000000003";
const applicantAProfileId = "10000000-0000-4000-8000-000000000001";
const applicantBProfileId = "10000000-0000-4000-8000-000000000002";
const jobAId = "20000000-0000-4000-8000-000000000001";
const jobBId = "20000000-0000-4000-8000-000000000002";
const jobDraftId = "20000000-0000-4000-8000-000000000003";
const unknownJobId = "20000000-0000-4000-8000-000000000004";

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
  "company-token": {
    id: companyUserId,
    email: "company@example.com",
    fullName: "Company",
    role: "COMPANY",
    accountStatus: "ACTIVE",
  },
};

function createMemoryRepository(): SavedJobsRepositoryContract & {
  saved: Array<{ applicantId: string; jobId: string; savedAt: string }>;
  closeJob(jobId: string): void;
} {
  const jobs: Array<{
    id: string;
    title: string;
    employmentType: string | null;
    location: string | null;
    status: JobStatus;
    deadline: string | null;
    companyName: string;
  }> = [
    {
      id: jobAId,
      title: "Backend Engineer",
      employmentType: "FULL_TIME",
      location: "Jakarta",
      status: "ACTIVE",
      deadline: "2099-12-31",
      companyName: "Company A",
    },
    {
      id: jobBId,
      title: "Platform Engineer",
      employmentType: "REMOTE",
      location: "Remote",
      status: "ACTIVE",
      deadline: null,
      companyName: "Company B",
    },
    {
      id: jobDraftId,
      title: "Draft Role",
      employmentType: null,
      location: null,
      status: "DRAFT",
      deadline: null,
      companyName: "Company A",
    },
  ];
  const profiles: Record<string, string> = {
    [applicantAUserId]: applicantAProfileId,
    [applicantBUserId]: applicantBProfileId,
  };
  const saved: Array<{ applicantId: string; jobId: string; savedAt: string }> = [];

  function page(
    applicantId: string,
    query: SavedJobListQuery,
  ): SavedJobPage {
    const filtered = saved
      .filter((entry) => entry.applicantId === applicantId)
      .sort((left, right) => {
        const bySavedTime = right.savedAt.localeCompare(left.savedAt);
        return bySavedTime || right.jobId.localeCompare(left.jobId);
      });
    const start = (query.page - 1) * query.pageSize;
    return {
      savedJobs: filtered
        .slice(start, start + query.pageSize)
        .map((entry) => {
          const job = jobs.find((item) => item.id === entry.jobId);
          assert.ok(job);
          return {
            jobId: entry.jobId,
            savedAt: entry.savedAt,
            job: {
              id: job.id,
              title: job.title,
              employmentType: job.employmentType,
              location: job.location,
              status: job.status,
              deadline: job.deadline,
              companyName: job.companyName,
            },
          };
        }),
      total: filtered.length,
    };
  }

  return {
    saved,
    closeJob(jobId: string) {
      const job = jobs.find((item) => item.id === jobId);
      assert.ok(job);
      job.status = "CLOSED";
    },
    async findApplicantProfileId(userId: string) {
      return profiles[userId] ?? null;
    },
    async findJobStatus(jobId: string) {
      return jobs.find((job) => job.id === jobId)?.status ?? null;
    },
    async createSavedJob(input: { applicantId: string; jobId: string }) {
      if (
        saved.some(
          (entry) =>
            entry.applicantId === input.applicantId &&
            entry.jobId === input.jobId,
        )
      ) {
        throw toSavedJobDatabaseHttpError({
          code: "23505",
          constraint: "saved_jobs_unique",
        });
      }
      saved.push({
        ...input,
        savedAt: new Date().toISOString(),
      });
    },
    async listSavedJobs(applicantId: string, query: SavedJobListQuery) {
      return page(applicantId, query);
    },
    async deleteSavedJob(applicantId: string, jobId: string) {
      const index = saved.findIndex(
        (entry) =>
          entry.applicantId === applicantId && entry.jobId === jobId,
      );
      if (index < 0) {
        return false;
      }
      saved.splice(index, 1);
      return true;
    },
  };
}

async function withSavedJobsServer(
  callback: (
    baseUrl: string,
    repository: ReturnType<typeof createMemoryRepository>,
  ) => Promise<void>,
): Promise<void> {
  const repository = createMemoryRepository();
  const authService = {
    register: async (_input: RegisterInput) => {},
    login: async (_input: LoginInput) => {
      throw new Error("login not used in saved jobs tests");
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
    undefined,
    new SavedJobsService(repository),
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

test("saved jobs require authentication and APPLICANT role", async () => {
  await withSavedJobsServer(async (baseUrl) => {
    const anonymous = await fetch(`${baseUrl}/api/applicant/saved-jobs`);
    const company = await fetch(
      `${baseUrl}/api/applicant/saved-jobs`,
      { headers: auth("company-token") },
    );
    const wrongRolePost = await fetch(
      `${baseUrl}/api/applicant/saved-jobs`,
      jsonRequest("company-token", "POST", { jobId: jobAId }),
    );
    assert.equal(anonymous.status, 401);
    assert.equal(company.status, 403);
    assert.equal(wrongRolePost.status, 403);
  });
});

test("applicant saves only ACTIVE jobs using profile ownership from JWT", async () => {
  await withSavedJobsServer(async (baseUrl, repository) => {
    const saved = await fetch(
      `${baseUrl}/api/applicant/saved-jobs`,
      jsonRequest("applicant-a-token", "POST", { jobId: jobAId }),
    );
    const body = z
      .object({
        success: z.literal(true),
        data: z.object({ jobId: z.string() }),
      })
      .parse(await saved.json());
    const draft = await fetch(
      `${baseUrl}/api/applicant/saved-jobs`,
      jsonRequest("applicant-a-token", "POST", { jobId: jobDraftId }),
    );
    const missing = await fetch(
      `${baseUrl}/api/applicant/saved-jobs`,
      jsonRequest("applicant-a-token", "POST", { jobId: unknownJobId }),
    );
    const invalidBody = await fetch(
      `${baseUrl}/api/applicant/saved-jobs`,
      jsonRequest("applicant-a-token", "POST", {
        jobId: jobBId,
        applicantId: applicantBProfileId,
      }),
    );

    assert.equal(saved.status, 201);
    assert.equal(body.data.jobId, jobAId);
    assert.equal(repository.saved[0]?.applicantId, applicantAProfileId);
    assert.equal(draft.status, 409);
    assert.equal(missing.status, 404);
    assert.equal(invalidBody.status, 400);
    assert.equal(repository.saved.length, 1);
  });
});

test("unique constraint conflicts return 409 without creating duplicates", async () => {
  await withSavedJobsServer(async (baseUrl, repository) => {
    const first = await fetch(
      `${baseUrl}/api/applicant/saved-jobs`,
      jsonRequest("applicant-a-token", "POST", { jobId: jobAId }),
    );
    const duplicate = await fetch(
      `${baseUrl}/api/applicant/saved-jobs`,
      jsonRequest("applicant-a-token", "POST", { jobId: jobAId }),
    );
    assert.equal(first.status, 201);
    assert.equal(duplicate.status, 409);
    assert.equal(repository.saved.length, 1);
  });

  assert.equal(
    toSavedJobDatabaseHttpError({
      code: "23505",
      constraint: "saved_jobs_unique",
    }).status,
    409,
  );
  assert.equal(
    toSavedJobDatabaseHttpError({
      code: "23505",
      constraint: "some_other_unique_constraint",
    }).status,
    503,
  );
});

test("saved list is paginated, private to its applicant, and shows updated job status", async () => {
  await withSavedJobsServer(async (baseUrl, repository) => {
    await fetch(
      `${baseUrl}/api/applicant/saved-jobs`,
      jsonRequest("applicant-a-token", "POST", { jobId: jobAId }),
    );
    await fetch(
      `${baseUrl}/api/applicant/saved-jobs`,
      jsonRequest("applicant-a-token", "POST", { jobId: jobBId }),
    );
    repository.closeJob(jobAId);

    const list = await fetch(
      `${baseUrl}/api/applicant/saved-jobs?page=1&pageSize=1`,
      { headers: auth("applicant-a-token") },
    );
    const listResponseSchema = z.object({
        success: z.literal(true),
        data: z.object({
          savedJobs: z.array(
            z.object({
              savedAt: z.string().nullable(),
              job: z.object({
                id: z.string(),
                status: z.enum(["ACTIVE", "CLOSED", "DRAFT"]),
                companyName: z.string(),
              }),
            }),
          ),
          pagination: z.object({
            page: z.number(),
            pageSize: z.number(),
            total: z.number(),
            totalPages: z.number(),
          }),
        }),
      });
    const listBody = listResponseSchema.parse(await list.json());
    const allSavedJobs = listResponseSchema.parse(
      await (
        await fetch(`${baseUrl}/api/applicant/saved-jobs?pageSize=10`, {
          headers: auth("applicant-a-token"),
        })
      ).json(),
    );
    const applicantBList = await fetch(
      `${baseUrl}/api/applicant/saved-jobs`,
      { headers: auth("applicant-b-token") },
    );
    const invalidPage = await fetch(
      `${baseUrl}/api/applicant/saved-jobs?page=0`,
      { headers: auth("applicant-a-token") },
    );

    assert.equal(list.status, 200);
    assert.equal(listBody.data.pagination.total, 2);
    assert.equal(listBody.data.pagination.totalPages, 2);
    assert.equal(applicantBList.status, 200);
    assert.ok(
      allSavedJobs.data.savedJobs.some((savedJob) => savedJob.job.status === "CLOSED"),
    );
    assert.equal(invalidPage.status, 400);
  });
});

test("applicant can delete only their own saved job", async () => {
  await withSavedJobsServer(async (baseUrl, repository) => {
    await fetch(
      `${baseUrl}/api/applicant/saved-jobs`,
      jsonRequest("applicant-a-token", "POST", { jobId: jobAId }),
    );
    const foreignDelete = await fetch(
      `${baseUrl}/api/applicant/saved-jobs/${jobAId}`,
      { method: "DELETE", headers: auth("applicant-b-token") },
    );
    const ownerDelete = await fetch(
      `${baseUrl}/api/applicant/saved-jobs/${jobAId}`,
      { method: "DELETE", headers: auth("applicant-a-token") },
    );
    const missingDelete = await fetch(
      `${baseUrl}/api/applicant/saved-jobs/${jobAId}`,
      { method: "DELETE", headers: auth("applicant-a-token") },
    );

    assert.equal(foreignDelete.status, 404);
    assert.equal(ownerDelete.status, 200);
    assert.equal(missingDelete.status, 404);
    assert.equal(repository.saved.length, 0);
  });
});
