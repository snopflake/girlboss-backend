import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import type { AuthServiceContract } from "../src/services/auth.service.js";
import type { AuthenticatedUser } from "../src/types/auth.types.js";
import type {
  ApplicantProfile,
  CompanyProfile,
} from "../src/types/profile.types.js";
import type { ProfileRepositoryContract } from "../src/repositories/profile.repository.js";
import { ProfileService } from "../src/services/profile.service.js";
import type {
  LoginInput,
  RegisterInput,
} from "../src/validators/auth.validator.js";
import { HttpError } from "../src/utils/httpError.js";
import { z } from "zod";

const applicantAId = "00000000-0000-4000-8000-000000000001";
const applicantBId = "00000000-0000-4000-8000-000000000002";
const companyAId = "00000000-0000-4000-8000-000000000003";
const companyBId = "00000000-0000-4000-8000-000000000004";

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
  "company-a-token": {
    id: companyAId,
    email: "company-a@example.com",
    fullName: "Company Contact A",
    role: "COMPANY",
    accountStatus: "ACTIVE",
  },
  "company-b-token": {
    id: companyBId,
    email: "company-b@example.com",
    fullName: "Company Contact B",
    role: "COMPANY",
    accountStatus: "ACTIVE",
  },
};

function createMemoryProfileRepository(): ProfileRepositoryContract & {
  applicantProfiles: Map<string, ApplicantProfile>;
  companyProfiles: Map<string, CompanyProfile>;
} {
  const applicantProfiles = new Map<string, ApplicantProfile>([
    [
      applicantAId,
      {
        headline: "Backend developer",
        phoneNumber: null,
        professionalSummary: "Applicant A summary",
      },
    ],
    [
      applicantBId,
      {
        headline: "Designer",
        phoneNumber: "08000000002",
        professionalSummary: "Applicant B summary",
      },
    ],
  ]);
  const companyProfiles = new Map<string, CompanyProfile>([
    [companyAId, { companyName: "Company A", industry: "Technology" }],
    [companyBId, { companyName: "Company B", industry: null }],
  ]);

  return {
    applicantProfiles,
    companyProfiles,
    async findApplicantProfile(userId) {
      const profile = applicantProfiles.get(userId);
      return profile ? { ...profile } : null;
    },
    async updateApplicantProfile(userId, input) {
      const profile = applicantProfiles.get(userId);
      if (!profile) {
        return null;
      }
      const updated = { ...profile, ...input };
      applicantProfiles.set(userId, updated);
      return { ...updated };
    },
    async findCompanyProfile(userId) {
      const profile = companyProfiles.get(userId);
      return profile ? { ...profile } : null;
    },
    async updateCompanyProfile(userId, input) {
      const profile = companyProfiles.get(userId);
      if (!profile) {
        return null;
      }
      const updated = { ...profile, ...input };
      companyProfiles.set(userId, updated);
      return { ...updated };
    },
  };
}

async function withProfileServer(
  callback: (
    baseUrl: string,
    repository: ReturnType<typeof createMemoryProfileRepository>,
  ) => Promise<void>,
): Promise<void> {
  const repository = createMemoryProfileRepository();
  const authService = {
    register: async (_input: RegisterInput) => {},
    login: async (_input: LoginInput) => {
      throw new Error("login not used in profile tests");
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
  const server = createServer(
    createApp(
      { CORS_ORIGIN: "http://localhost:5173", NODE_ENV: "test" },
      authService,
      undefined,
      new ProfileService(repository),
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

const profileResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.record(z.string(), z.unknown()),
});

test("applicant can get and update only their profile fields", async () => {
  await withProfileServer(async (baseUrl, repository) => {
    const getResponse = await fetch(`${baseUrl}/api/applicant/profile`, {
      headers: auth("applicant-a-token"),
    });
    const getBody = profileResponseSchema.parse(await getResponse.json());
    assert.equal(getResponse.status, 200);
    assert.deepEqual(getBody.data, {
      fullName: "Applicant A",
      headline: "Backend developer",
      phoneNumber: null,
      professionalSummary: "Applicant A summary",
    });

    const patchResponse = await fetch(`${baseUrl}/api/applicant/profile`, {
      method: "PATCH",
      headers: { ...auth("applicant-a-token"), "content-type": "application/json" },
      body: JSON.stringify({
        headline: "Senior backend developer",
        phoneNumber: "08000000001",
        professionalSummary: null,
      }),
    });
    const patchBody = profileResponseSchema.parse(await patchResponse.json());
    assert.equal(patchResponse.status, 200);
    assert.deepEqual(patchBody.data, {
      fullName: "Applicant A",
      headline: "Senior backend developer",
      phoneNumber: "08000000001",
      professionalSummary: null,
    });
    assert.deepEqual(repository.applicantProfiles.get(applicantAId), {
      headline: "Senior backend developer",
      phoneNumber: "08000000001",
      professionalSummary: null,
    });
  });
});

test("applicant profile PATCH rejects empty, invalid, and unknown fields", async () => {
  await withProfileServer(async (baseUrl, repository) => {
    const emptyPatch = await fetch(`${baseUrl}/api/applicant/profile`, {
      method: "PATCH",
      headers: { ...auth("applicant-a-token"), "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const invalidValue = await fetch(`${baseUrl}/api/applicant/profile`, {
      method: "PATCH",
      headers: { ...auth("applicant-a-token"), "content-type": "application/json" },
      body: JSON.stringify({ headline: " " }),
    });
    const unauthorizedFields = await fetch(`${baseUrl}/api/applicant/profile`, {
      method: "PATCH",
      headers: { ...auth("applicant-a-token"), "content-type": "application/json" },
      body: JSON.stringify({
        headline: "Changed",
        role_id: "another-role",
        account_status: "DISABLED",
        user_id: applicantBId,
      }),
    });

    assert.equal(emptyPatch.status, 400);
    assert.equal(invalidValue.status, 400);
    assert.equal(unauthorizedFields.status, 400);
    assert.equal(
      repository.applicantProfiles.get(applicantAId)?.headline,
      "Backend developer",
    );
  });
});

test("company can get and update only their profile fields", async () => {
  await withProfileServer(async (baseUrl, repository) => {
    const getResponse = await fetch(`${baseUrl}/api/company/profile`, {
      headers: auth("company-a-token"),
    });
    const getBody = profileResponseSchema.parse(await getResponse.json());
    assert.equal(getResponse.status, 200);
    assert.deepEqual(getBody.data, {
      fullName: "Company Contact A",
      companyName: "Company A",
      industry: "Technology",
    });

    const patchResponse = await fetch(`${baseUrl}/api/company/profile`, {
      method: "PATCH",
      headers: { ...auth("company-a-token"), "content-type": "application/json" },
      body: JSON.stringify({ companyName: "Updated Company", industry: null }),
    });
    const patchBody = profileResponseSchema.parse(await patchResponse.json());
    assert.equal(patchResponse.status, 200);
    assert.deepEqual(patchBody.data, {
      fullName: "Company Contact A",
      companyName: "Updated Company",
      industry: null,
    });
    assert.deepEqual(repository.companyProfiles.get(companyAId), {
      companyName: "Updated Company",
      industry: null,
    });
  });
});

test("company profile PATCH rejects empty, invalid, and protected fields", async () => {
  await withProfileServer(async (baseUrl, repository) => {
    const emptyPatch = await fetch(`${baseUrl}/api/company/profile`, {
      method: "PATCH",
      headers: { ...auth("company-a-token"), "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const invalidValue = await fetch(`${baseUrl}/api/company/profile`, {
      method: "PATCH",
      headers: { ...auth("company-a-token"), "content-type": "application/json" },
      body: JSON.stringify({ companyName: " " }),
    });
    const protectedFields = await fetch(`${baseUrl}/api/company/profile`, {
      method: "PATCH",
      headers: { ...auth("company-a-token"), "content-type": "application/json" },
      body: JSON.stringify({
        companyName: "Attempted",
        verification_status: "VERIFIED",
        user_id: companyBId,
      }),
    });

    assert.equal(emptyPatch.status, 400);
    assert.equal(invalidValue.status, 400);
    assert.equal(protectedFields.status, 400);
    assert.equal(
      repository.companyProfiles.get(companyAId)?.companyName,
      "Company A",
    );
  });
});

test("profile endpoints require authentication and the matching role", async () => {
  await withProfileServer(async (baseUrl) => {
    const applicantUnauthenticated = await fetch(
      `${baseUrl}/api/applicant/profile`,
    );
    const companyUnauthenticated = await fetch(
      `${baseUrl}/api/company/profile`,
    );
    const applicantWrongRole = await fetch(
      `${baseUrl}/api/applicant/profile`,
      { headers: auth("company-a-token") },
    );
    const companyWrongRole = await fetch(`${baseUrl}/api/company/profile`, {
      headers: auth("applicant-a-token"),
    });

    assert.equal(applicantUnauthenticated.status, 401);
    assert.equal(companyUnauthenticated.status, 401);
    assert.equal(applicantWrongRole.status, 403);
    assert.equal(companyWrongRole.status, 403);
  });
});

test("a caller cannot read another applicant or company profile by supplying an owner id", async () => {
  await withProfileServer(async (baseUrl) => {
    const otherApplicant = await fetch(
      `${baseUrl}/api/applicant/profile?user_id=${applicantAId}`,
      { headers: auth("applicant-b-token") },
    );
    const otherApplicantBody = profileResponseSchema.parse(
      await otherApplicant.json(),
    );
    const otherCompany = await fetch(
      `${baseUrl}/api/company/profile?user_id=${companyAId}`,
      { headers: auth("company-b-token") },
    );
    const otherCompanyBody = profileResponseSchema.parse(
      await otherCompany.json(),
    );

    assert.equal(otherApplicant.status, 200);
    assert.equal(otherApplicantBody.data.fullName, "Applicant B");
    assert.equal(otherApplicantBody.data.headline, "Designer");
    assert.equal(otherApplicantBody.data.professionalSummary, "Applicant B summary");
    assert.equal(otherCompany.status, 200);
    assert.equal(otherCompanyBody.data.fullName, "Company Contact B");
    assert.equal(otherCompanyBody.data.companyName, "Company B");
  });
});
