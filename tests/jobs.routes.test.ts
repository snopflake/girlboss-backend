import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import type { AuthServiceContract } from "../src/services/auth.service.js";
import { JobsService } from "../src/services/jobs.service.js";
import type {
  JobPage,
  JobsRepositoryContract,
} from "../src/repositories/jobs.repository.js";
import type {
  CompanyJobProfile,
  JobRecord,
  JobStatus,
} from "../src/types/jobs.types.js";
import type {
  CreateJobInput,
  JobListQuery,
  UpdateJobInput,
} from "../src/validators/jobs.validator.js";
import type { AuthenticatedUser } from "../src/types/auth.types.js";
import type {
  LoginInput,
  RegisterInput,
} from "../src/validators/auth.validator.js";
import { z } from "zod";

const jobResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  employmentType: z.string().nullable(),
  location: z.string().nullable(),
  deadline: z.string().nullable(),
});
const jobListResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    jobs: z.array(jobResponseSchema),
    pagination: z.object({
      page: z.number(),
      pageSize: z.number(),
      total: z.number(),
      totalPages: z.number(),
    }),
  }),
});
const jobItemResponseSchema = z.object({
  success: z.boolean(),
  data: jobResponseSchema,
});

const companyAUserId = "00000000-0000-4000-8000-000000000001";
const companyBUserId = "00000000-0000-4000-8000-000000000002";
const applicantUserId = "00000000-0000-4000-8000-000000000003";
const companyAId = "10000000-0000-4000-8000-000000000001";
const companyBId = "10000000-0000-4000-8000-000000000002";

const users: Record<string, AuthenticatedUser> = {
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
  "applicant-token": {
    id: applicantUserId,
    email: "applicant@example.com",
    fullName: "Applicant",
    role: "APPLICANT",
    accountStatus: "ACTIVE",
  },
};

function makeJob(
  id: string,
  companyId: string,
  title: string,
  status: JobStatus,
  values: Partial<Pick<JobRecord, "employmentType" | "location" | "deadline">> = {},
): JobRecord {
  return {
    id,
    companyId,
    title,
    employmentType:
      values.employmentType === undefined ? "FULL_TIME" : values.employmentType,
    location: values.location === undefined ? "Jakarta" : values.location,
    status,
    deadline: values.deadline === undefined ? "2099-12-31" : values.deadline,
  };
}

function createMemoryRepository(): JobsRepositoryContract & {
  jobs: JobRecord[];
  createdCompanyIds: string[];
} {
  const jobs = [
    makeJob("20000000-0000-4000-8000-000000000001", companyAId, "Senior Engineer", "ACTIVE"),
    makeJob("20000000-0000-4000-8000-000000000002", companyAId, "Backend Engineer", "ACTIVE"),
    makeJob("20000000-0000-4000-8000-000000000003", companyAId, "Draft Role", "DRAFT"),
    makeJob("20000000-0000-4000-8000-000000000004", companyAId, "Closed Role", "CLOSED"),
    makeJob("20000000-0000-4000-8000-000000000005", companyAId, "Expired Role", "ACTIVE", {
      deadline: "2000-01-01",
    }),
    makeJob("20000000-0000-4000-8000-000000000006", companyBId, "Other Company Role", "ACTIVE"),
  ];
  const companies: Record<string, CompanyJobProfile> = {
    [companyAUserId]: { id: companyAId, verificationStatus: "PENDING" },
    [companyBUserId]: { id: companyBId, verificationStatus: "VERIFIED" },
  };
  const createdCompanyIds: string[] = [];

  function page(items: JobRecord[], pageNumber: number, pageSize: number): JobPage {
    const start = (pageNumber - 1) * pageSize;
    return { jobs: items.slice(start, start + pageSize), total: items.length };
  }

  return {
    jobs,
    createdCompanyIds,
    async findPublicJobs(query: JobListQuery, currentDate: string): Promise<JobPage> {
      const filtered = jobs
        .filter(
          (job) =>
            job.status === "ACTIVE" &&
            (job.deadline === null || job.deadline >= currentDate),
        )
        .filter((job) =>
          query.search
            ? job.title.toLowerCase().includes(query.search.toLowerCase())
            : true,
        )
        .filter((job) =>
          query.employmentType
            ? job.employmentType === query.employmentType
            : true,
        )
        .filter((job) =>
          query.location
            ? job.location?.toLowerCase().includes(query.location.toLowerCase())
            : true,
        )
        .sort((left, right) => left.id.localeCompare(right.id));
      return page(filtered, query.page, query.pageSize);
    },
    async findPublicJobById(id: string, currentDate: string) {
      return (
        jobs.find(
          (job) =>
            job.id === id &&
            job.status === "ACTIVE" &&
            (job.deadline === null || job.deadline >= currentDate),
        ) ?? null
      );
    },
    async findCompanyByUserId(userId: string) {
      return companies[userId] ?? null;
    },
    async createCompanyJob(companyId: string, input: CreateJobInput) {
      createdCompanyIds.push(companyId);
      const job = makeJob(randomUUID(), companyId, input.title, "DRAFT", {
        employmentType: input.employmentType ?? null,
        location: input.location ?? null,
        deadline: input.deadline ?? null,
      });
      jobs.push(job);
      return job;
    },
    async findCompanyJobs(companyId: string, pageNumber: number, pageSize: number) {
      const ownJobs = jobs
        .filter((job) => job.companyId === companyId)
        .sort((left, right) => left.id.localeCompare(right.id));
      return page(ownJobs, pageNumber, pageSize);
    },
    async findCompanyJobById(id: string, companyId: string) {
      return jobs.find((job) => job.id === id && job.companyId === companyId) ?? null;
    },
    async updateCompanyJob(id: string, companyId: string, input: UpdateJobInput) {
      const job = jobs.find((item) => item.id === id && item.companyId === companyId);
      if (!job) {
        return null;
      }
      if (input.title !== undefined) job.title = input.title;
      if (input.employmentType !== undefined) job.employmentType = input.employmentType;
      if (input.location !== undefined) job.location = input.location;
      if (input.deadline !== undefined) job.deadline = input.deadline;
      return job;
    },
    async updateCompanyJobStatus(id: string, companyId: string, status: JobStatus) {
      const job = jobs.find((item) => item.id === id && item.companyId === companyId);
      if (!job) {
        return null;
      }
      job.status = status;
      return job;
    },
  };
}

async function withJobsServer(
  callback: (baseUrl: string, repository: ReturnType<typeof createMemoryRepository>) => Promise<void>,
): Promise<void> {
  const repository = createMemoryRepository();
  const authService = {
    register: async (_input: RegisterInput) => {},
    login: async (_input: LoginInput) => {
      throw new Error("login not used in jobs tests");
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
  const server = createServer(
    createApp(
      { CORS_ORIGIN: "http://localhost:5173", NODE_ENV: "test" },
      authService,
      new JobsService(repository),
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

test("public jobs only expose active non-expired records and public details hide other statuses", async () => {
  await withJobsServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/jobs`);
    const body = jobListResponseSchema.parse(await response.json());
    assert.equal(response.status, 200);
    assert.ok(body.data.jobs.length > 0);
    assert.ok(body.data.jobs.every((job: { status: string }) => job.status === "ACTIVE"));
    assert.ok(body.data.jobs.every((job: { title: string }) => job.title !== "Expired Role"));
    assert.equal("companyId" in body.data.jobs[0], false);

    const activeDetail = await fetch(
      `${baseUrl}/api/jobs/20000000-0000-4000-8000-000000000001`,
    );
    const activeDetailBody = jobItemResponseSchema.parse(await activeDetail.json());
    const draftId = "20000000-0000-4000-8000-000000000003";
    const hiddenDetail = await fetch(`${baseUrl}/api/jobs/${draftId}`);
    assert.equal(activeDetail.status, 200);
    assert.equal(activeDetailBody.data.status, "ACTIVE");
    assert.equal(hiddenDetail.status, 404);
  });
});

test("company can create a DRAFT using the company profile resolved from its JWT user", async () => {
  await withJobsServer(async (baseUrl, repository) => {
    const response = await fetch(`${baseUrl}/api/company/jobs`, {
      method: "POST",
      headers: { ...auth("company-a-token"), "content-type": "application/json" },
      body: JSON.stringify({
        title: "Test role",
        employmentType: "PART_TIME",
        location: "Malang",
        deadline: "2099-12-31",
      }),
    });
    const body = jobItemResponseSchema.parse(await response.json());
    assert.equal(response.status, 201);
    assert.equal(body.data.status, "DRAFT");
    assert.deepEqual(repository.createdCompanyIds, [companyAId]);
  });
});

test("applicant cannot create company jobs", async () => {
  await withJobsServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/company/jobs`, {
      method: "POST",
      headers: { ...auth("applicant-token"), "content-type": "application/json" },
      body: JSON.stringify({ title: "Test role" }),
    });
    assert.equal(response.status, 403);
  });
});

test("company job endpoints require a JWT", async () => {
  await withJobsServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/company/jobs`);
    assert.equal(response.status, 401);
  });
});

test("company list only returns its own jobs and supports pagination", async () => {
  await withJobsServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/company/jobs?page=1&pageSize=2`, {
      headers: auth("company-a-token"),
    });
    const body = jobListResponseSchema.parse(await response.json());
    assert.equal(response.status, 200);
    assert.equal(body.data.jobs.length, 2);
    assert.ok(body.data.jobs.every((job: { title: string }) => job.title !== "Other Company Role"));
    assert.equal(body.data.pagination.total, 5);
  });
});

test("company cannot update a job owned by another company", async () => {
  await withJobsServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/company/jobs/20000000-0000-4000-8000-000000000006`,
      {
        method: "PATCH",
        headers: { ...auth("company-a-token"), "content-type": "application/json" },
        body: JSON.stringify({ title: "Attempted takeover" }),
      },
    );
    assert.equal(response.status, 404);
  });
});

test("company can update allowed job fields without changing status or ownership", async () => {
  await withJobsServer(async (baseUrl, repository) => {
    const response = await fetch(
      `${baseUrl}/api/company/jobs/20000000-0000-4000-8000-000000000001`,
      {
        method: "PATCH",
        headers: { ...auth("company-a-token"), "content-type": "application/json" },
        body: JSON.stringify({ title: "Updated Engineer", deadline: null }),
      },
    );
    const body = jobItemResponseSchema.parse(await response.json());
    const updatedJob = repository.jobs.find(
      (job) => job.id === "20000000-0000-4000-8000-000000000001",
    );
    assert.equal(response.status, 200);
    assert.equal(body.data.title, "Updated Engineer");
    assert.equal(body.data.status, "ACTIVE");
    assert.equal(updatedJob?.companyId, companyAId);
    assert.equal(updatedJob?.deadline, null);
  });
});

test("job create and partial update reject invalid and unauthorized fields", async () => {
  await withJobsServer(async (baseUrl) => {
    const invalidCreate = await fetch(`${baseUrl}/api/company/jobs`, {
      method: "POST",
      headers: { ...auth("company-a-token"), "content-type": "application/json" },
      body: JSON.stringify({ title: "  " }),
    });
    const unauthorizedFields = await fetch(`${baseUrl}/api/company/jobs`, {
      method: "POST",
      headers: { ...auth("company-a-token"), "content-type": "application/json" },
      body: JSON.stringify({ title: "Test", company_id: companyBId }),
    });
    const emptyUpdate = await fetch(
      `${baseUrl}/api/company/jobs/20000000-0000-4000-8000-000000000001`,
      {
        method: "PATCH",
        headers: { ...auth("company-a-token"), "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const unauthorizedUpdate = await fetch(
      `${baseUrl}/api/company/jobs/20000000-0000-4000-8000-000000000001`,
      {
        method: "PATCH",
        headers: { ...auth("company-a-token"), "content-type": "application/json" },
        body: JSON.stringify({ company_id: companyBId }),
      },
    );
    assert.equal(invalidCreate.status, 400);
    assert.equal(unauthorizedFields.status, 400);
    assert.equal(emptyUpdate.status, 400);
    assert.equal(unauthorizedUpdate.status, 400);
  });
});

test("pending company cannot publish a draft", async () => {
  await withJobsServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/company/jobs/20000000-0000-4000-8000-000000000003/status`,
      {
        method: "PATCH",
        headers: { ...auth("company-a-token"), "content-type": "application/json" },
        body: JSON.stringify({ status: "ACTIVE" }),
      },
    );
    assert.equal(response.status, 403);
  });
});

test("verified company can publish a valid draft", async () => {
  await withJobsServer(async (baseUrl, repository) => {
    repository.jobs.push(
      makeJob("20000000-0000-4000-8000-000000000007", companyBId, "Ready to publish", "DRAFT"),
    );
    const response = await fetch(
      `${baseUrl}/api/company/jobs/20000000-0000-4000-8000-000000000007/status`,
      {
        method: "PATCH",
        headers: { ...auth("company-b-token"), "content-type": "application/json" },
        body: JSON.stringify({ status: "ACTIVE" }),
      },
    );
    const body = jobItemResponseSchema.parse(await response.json());
    assert.equal(response.status, 200);
    assert.equal(body.data.status, "ACTIVE");
  });
});

test("verified company cannot publish a draft with an expired deadline", async () => {
  await withJobsServer(async (baseUrl, repository) => {
    repository.jobs.push(
      makeJob("20000000-0000-4000-8000-000000000008", companyBId, "Expired draft", "DRAFT", {
        deadline: "2000-01-01",
      }),
    );
    const response = await fetch(
      `${baseUrl}/api/company/jobs/20000000-0000-4000-8000-000000000008/status`,
      {
        method: "PATCH",
        headers: { ...auth("company-b-token"), "content-type": "application/json" },
        body: JSON.stringify({ status: "ACTIVE" }),
      },
    );
    assert.equal(response.status, 400);
  });
});

test("invalid status values return 400 and CLOSED jobs cannot be reopened", async () => {
  await withJobsServer(async (baseUrl) => {
    const unsupported = await fetch(
      `${baseUrl}/api/company/jobs/20000000-0000-4000-8000-000000000003/status`,
      {
        method: "PATCH",
        headers: { ...auth("company-a-token"), "content-type": "application/json" },
        body: JSON.stringify({ status: "PUBLISHED" }),
      },
    );
    const terminalTransition = await fetch(
      `${baseUrl}/api/company/jobs/20000000-0000-4000-8000-000000000004/status`,
      {
        method: "PATCH",
        headers: { ...auth("company-a-token"), "content-type": "application/json" },
        body: JSON.stringify({ status: "DRAFT" }),
      },
    );
    assert.equal(unsupported.status, 400);
    assert.equal(terminalTransition.status, 409);
  });
});

test("public search filters, pagination, and invalid query values are handled", async () => {
  await withJobsServer(async (baseUrl) => {
    const filtered = await fetch(
      `${baseUrl}/api/jobs?page=1&pageSize=1&search=Engineer&employmentType=FULL_TIME&location=Jakarta`,
    );
    const filteredBody = jobListResponseSchema.parse(await filtered.json());
    assert.equal(filtered.status, 200);
    assert.equal(filteredBody.data.jobs.length, 1);
    assert.match(filteredBody.data.jobs[0].title, /Engineer/);
    assert.equal(filteredBody.data.pagination.total, 2);

    const secondPage = await fetch(`${baseUrl}/api/jobs?page=2&pageSize=2`);
    const secondPageBody = jobListResponseSchema.parse(await secondPage.json());
    assert.equal(secondPage.status, 200);
    assert.equal(secondPageBody.data.jobs.length, 1);

    const invalid = await fetch(`${baseUrl}/api/jobs?page=0&pageSize=101`);
    assert.equal(invalid.status, 400);
  });
});
