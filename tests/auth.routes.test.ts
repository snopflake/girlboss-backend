import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import type { AuthServiceContract } from "../src/services/auth.service.js";
import type {
  AuthenticatedUser,
  CurrentUserData,
} from "../src/types/auth.types.js";
import type {
  LoginInput,
  RegisterInput,
} from "../src/validators/auth.validator.js";
import { HttpError } from "../src/utils/httpError.js";
import { z } from "zod";

const loginResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    user: z.object({
      id: z.string(),
      email: z.email(),
      fullName: z.string(),
      role: z.enum(["APPLICANT", "COMPANY", "ADMIN"]),
      accountStatus: z.string(),
    }),
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresIn: z.number(),
  }),
});

const currentUserResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    id: z.string(),
    email: z.email(),
    fullName: z.string(),
    role: z.enum(["APPLICANT", "COMPANY", "ADMIN"]),
    accountStatus: z.string(),
    profile: z.record(z.string(), z.union([z.string(), z.null()])),
  }),
});

const applicant: AuthenticatedUser = {
  id: "applicant-id",
  email: "applicant@example.com",
  fullName: "Applicant User",
  role: "APPLICANT",
  accountStatus: "ACTIVE",
};
const company: AuthenticatedUser = {
  ...applicant,
  id: "company-id",
  email: "company@example.com",
  role: "COMPANY",
};
const admin: AuthenticatedUser = {
  ...applicant,
  id: "admin-id",
  email: "admin@example.com",
  role: "ADMIN",
};

function createFakeAuthService(
  overrides: Partial<AuthServiceContract> = {},
): AuthServiceContract {
  return {
    register: async (_input: RegisterInput) => {},
    login: async (_input: LoginInput) => ({
      user: applicant,
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      expiresIn: 3600,
    }),
    authenticate: async (accessToken: string) => {
      const users: Record<string, AuthenticatedUser> = {
        "test-access-token": applicant,
        "test-company-token": company,
        "test-admin-token": admin,
      };
      const user = users[accessToken];
      if (!user) {
        throw new HttpError(401, "Token tidak valid atau telah kedaluwarsa.");
      }
      return user;
    },
    getCurrentUser: async (user: AuthenticatedUser) =>
      ({ ...user, profile: { headline: "Profile" } }) satisfies CurrentUserData,
    ...overrides,
  };
}

async function withServer(
  callback: (baseUrl: string) => Promise<void>,
  options: {
    environment?: "development" | "test" | "production";
    authService?: AuthServiceContract;
  } = {},
): Promise<void> {
  const server = createServer(
    createApp(
      {
        CORS_ORIGIN: "http://localhost:5173",
        NODE_ENV: options.environment ?? "development",
      },
      options.authService ?? createFakeAuthService(),
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

test("registration validates allowed account types and rejects privileged fields", async () => {
  const registrations: RegisterInput[] = [];
  const service = createFakeAuthService({
    register: async (input) => {
      registrations.push(input);
    },
  });

  await withServer(async (baseUrl) => {
    const applicantResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fullName: "Applicant User",
        email: "applicant@example.com",
        password: "Password123!",
        accountType: "APPLICANT",
      }),
    });
    const companyResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fullName: "Company User",
        email: "company@example.com",
        password: "Password123!",
        accountType: "COMPANY",
        companyName: "GirlBoss Ltd",
      }),
    });
    const adminResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fullName: "Admin",
        email: "admin@example.com",
        password: "Password123!",
        accountType: "ADMIN",
      }),
    });
    const privilegedFieldsResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fullName: "Applicant User",
        email: "applicant@example.com",
        password: "Password123!",
        accountType: "APPLICANT",
        role_id: "admin-role-id",
        account_status: "ACTIVE",
      }),
    });
    const companyWithoutNameResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fullName: "Company User",
        email: "company@example.com",
        password: "Password123!",
        accountType: "COMPANY",
      }),
    });

    assert.equal(applicantResponse.status, 202);
    assert.equal(companyResponse.status, 202);
    assert.equal(adminResponse.status, 400);
    assert.equal(privilegedFieldsResponse.status, 400);
    assert.equal(companyWithoutNameResponse.status, 400);
  }, { authService: service });

  assert.deepEqual(
    registrations.map((registration) => registration.accountType),
    ["APPLICANT", "COMPANY"],
  );
});

test("login rejects invalid input and returns only the successful session response", async () => {
  await withServer(async (baseUrl) => {
    const invalidResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-an-email", password: "" }),
    });
    assert.equal(invalidResponse.status, 400);

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "applicant@example.com",
        password: "Password123!",
      }),
    });
    const body = loginResponseSchema.parse(await loginResponse.json());

    assert.equal(loginResponse.status, 200);
    assert.deepEqual(body.data.user, {
      id: applicant.id,
      email: applicant.email,
      fullName: applicant.fullName,
      role: applicant.role,
      accountStatus: applicant.accountStatus,
    });
    assert.equal(body.data.accessToken, "test-access-token");
    assert.equal(body.data.refreshToken, "test-refresh-token");
  });
});

test("login returns safe errors for incorrect credentials and unverified accounts", async () => {
  const service = createFakeAuthService({
    login: async (input) => {
      if (input.password === "wrong-password") {
        throw new HttpError(401, "Email atau password salah.");
      }
      throw new HttpError(403, "Email belum diverifikasi.");
    },
  });

  await withServer(async (baseUrl) => {
    const wrongPassword = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "applicant@example.com",
        password: "wrong-password",
      }),
    });
    const unverifiedAccount = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "applicant@example.com",
        password: "Password123!",
      }),
    });

    assert.equal(wrongPassword.status, 401);
    assert.equal(unverifiedAccount.status, 403);
  }, { authService: service });
});

test("current-user and role routes enforce authentication and authorization", async () => {
  await withServer(async (baseUrl) => {
    const unauthenticated = await fetch(`${baseUrl}/api/auth/me`);
    const invalidToken = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: "Bearer invalid-token" },
    });
    const currentUser = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: "Bearer test-access-token" },
    });
    const roleDenied = await fetch(`${baseUrl}/api/company/test`, {
      headers: { authorization: "Bearer test-access-token" },
    });
    const roleAllowed = await fetch(`${baseUrl}/api/applicant/test`, {
      headers: { authorization: "Bearer test-access-token" },
    });
    const companyAllowed = await fetch(`${baseUrl}/api/company/test`, {
      headers: { authorization: "Bearer test-company-token" },
    });
    const adminAllowed = await fetch(`${baseUrl}/api/admin/test`, {
      headers: { authorization: "Bearer test-admin-token" },
    });

    assert.equal(unauthenticated.status, 401);
    assert.equal(invalidToken.status, 401);
    assert.equal(currentUser.status, 200);
    assert.equal(roleDenied.status, 403);
    assert.equal(roleAllowed.status, 200);
    assert.equal(companyAllowed.status, 200);
    assert.equal(adminAllowed.status, 200);

    const body = currentUserResponseSchema.parse(await currentUser.json());
    assert.deepEqual(body.data, {
      ...applicant,
      profile: { headline: "Profile" },
    });
  });
});

test("development role-test routes are not registered in production", async () => {
  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/admin/test`, {
        headers: { authorization: "Bearer test-access-token" },
      });
      assert.equal(response.status, 404);
    },
    { environment: "production" },
  );
});

test("rate limit rejects excessive registration attempts", async () => {
  await withServer(async (baseUrl) => {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      response = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: "Applicant",
          email: `applicant${attempt}@example.com`,
          password: "Password123!",
          accountType: "APPLICANT",
        }),
      });
    }

    assert.equal(response?.status, 429);
  });
});

