import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import type {
  InterviewSessionsRepositoryContract,
} from "../src/repositories/interview-sessions.repository.js";
import type {
  InterviewAnswer,
  InterviewSession,
} from "../src/types/interview-sessions.types.js";
import type {
  AuthenticatedUser,
} from "../src/types/auth.types.js";
import type { AuthServiceContract } from "../src/services/auth.service.js";
import type {
  LoginInput,
  RegisterInput,
} from "../src/validators/auth.validator.js";
import type { InterviewAiProviderContract } from "../src/services/gemini-interview-provider.js";
import { InterviewSessionsService } from "../src/services/interview-sessions.service.js";
import { GeminiJsonGenerator } from "../src/services/gemini-json-generator.js";
import { GeminiInterviewProvider } from "../src/services/gemini-interview-provider.js";
import type {
  InterviewEvaluationResult,
  InterviewQuestionsResult,
} from "../src/validators/interview-sessions.validator.js";
import { HttpError } from "../src/utils/httpError.js";

const applicantAId = "00000000-0000-4000-8000-000000000001";
const applicantBId = "00000000-0000-4000-8000-000000000002";
const companyId = "00000000-0000-4000-8000-000000000003";
const applicantAProfileId = "10000000-0000-4000-8000-000000000001";
const applicantBProfileId = "10000000-0000-4000-8000-000000000002";

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

const generatedQuestions: InterviewQuestionsResult = {
  questions: [
    "Can you describe a project relevant to this role and your contribution?",
    "How do you prioritize competing deadlines while maintaining quality?",
    "Tell me about a time you addressed an unexpected technical challenge.",
    "How do you collaborate with people who have different working styles?",
    "What would you focus on during your first months in this position?",
  ],
};

const evaluationResult: InterviewEvaluationResult = {
  dimensions: {
    relevance: { score: 4, feedback: "Contoh yang diberikan sesuai." },
    clarity: { score: 4, feedback: "Alur jawaban cukup mudah diikuti." },
    completeness: { score: 3, feedback: "Tambahkan hasil yang terukur." },
    delivery: { score: 4, feedback: "Sampaikan langkah secara ringkas." },
  },
  overallFeedback: "Jawaban relevan; sertakan dampak yang lebih terukur.",
  improvementTips: ["Jelaskan hasil menggunakan metrik yang spesifik."],
};

interface StoredQuestion {
  id: string;
  questionText: string;
  sequenceNumber: number;
  answer: InterviewAnswer | null;
}

interface StoredSession {
  id: string;
  applicantId: string;
  jobTitle: string;
  status: string;
  startedAt: string;
  questions: StoredQuestion[];
}

function createMemoryRepository(): InterviewSessionsRepositoryContract & {
  sessions: StoredSession[];
} {
  const sessions: StoredSession[] = [];
  const profiles: Record<string, string> = {
    [applicantAId]: applicantAProfileId,
    [applicantBId]: applicantBProfileId,
  };
  let nextSessionId = 1;
  let nextQuestionId = 1;
  let nextAnswerId = 1;

  const asInterviewSession = (record: StoredSession): InterviewSession => {
    const questions = record.questions.map((question) => ({
      id: question.id,
      questionText: question.questionText,
      sequenceNumber: question.sequenceNumber,
      answer: question.answer,
    }));
    const evaluations = questions.flatMap((question) =>
      question.answer?.evaluation ? [question.answer.evaluation] : [],
    );
    const average = (scores: number[]) =>
      Math.round(
        (scores.reduce((total, score) => total + score, 0) / scores.length) *
          10,
      ) / 10;
    return {
      id: record.id,
      jobTitle: record.jobTitle,
      status: record.status,
      startedAt: record.startedAt,
      questions,
      summary:
        record.status !== "COMPLETED" || evaluations.length === 0
          ? null
          : {
              answeredQuestions: evaluations.length,
              totalQuestions: questions.length,
              averageScore: average(evaluations.map((item) => item.score)),
              dimensionAverages: {
                relevance: average(
                  evaluations.map((item) => item.result.dimensions.relevance.score),
                ),
                clarity: average(
                  evaluations.map((item) => item.result.dimensions.clarity.score),
                ),
                completeness: average(
                  evaluations.map(
                    (item) => item.result.dimensions.completeness.score,
                  ),
                ),
                delivery: average(
                  evaluations.map((item) => item.result.dimensions.delivery.score),
                ),
              },
              improvementTips: [
                ...new Set(
                  evaluations.flatMap((item) => item.result.improvementTips),
                ),
              ].slice(0, 5),
            },
    };
  };

  const getOwned = (id: string, applicantId: string) => {
    const record = sessions.find(
      (item) => item.id === id && item.applicantId === applicantId,
    );
    return record ? asInterviewSession(record) : null;
  };

  return {
    sessions,
    async findApplicantProfileId(userId) {
      return profiles[userId] ?? null;
    },
    async countSince(applicantId, since) {
      return sessions.filter(
        (item) =>
          item.applicantId === applicantId && item.startedAt >= since,
      ).length;
    },
    async createWithQuestions(applicantId, jobTitle, questions) {
      const sessionId =
        `30000000-0000-4000-8000-${String(nextSessionId++).padStart(12, "0")}`;
      const record: StoredSession = {
        id: sessionId,
        applicantId,
        jobTitle,
        status: "IN_PROGRESS",
        startedAt: new Date().toISOString(),
        questions: questions.map((questionText, index) => ({
          id: `40000000-0000-4000-8000-${String(nextQuestionId++).padStart(12, "0")}`,
          questionText,
          sequenceNumber: index + 1,
          answer: null,
        })),
      };
      sessions.push(record);
      return asInterviewSession(record);
    },
    async list(applicantId, query) {
      const filtered = sessions
        .filter((item) => item.applicantId === applicantId)
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
      const start = (query.page - 1) * query.pageSize;
      return {
        sessions: filtered
          .slice(start, start + query.pageSize)
          .map(asInterviewSession),
        total: filtered.length,
      };
    },
    async findById(id, applicantId) {
      return getOwned(id, applicantId);
    },
    async findQuestion(sessionId, questionId) {
      const session = sessions.find((item) => item.id === sessionId);
      const question = session?.questions.find((item) => item.id === questionId);
      return question
        ? { id: question.id, questionText: question.questionText }
        : null;
    },
    async hasAnswer(questionId) {
      return sessions.some((session) =>
        session.questions.some(
          (question) => question.id === questionId && question.answer !== null,
        ),
      );
    },
    async createAnswerWithEvaluation(
      questionId,
      answerText,
      evaluation,
    ) {
      const question = sessions
        .flatMap((session) => session.questions)
        .find((item) => item.id === questionId);
      if (!question || question.answer) {
        throw new HttpError(409, "Pertanyaan ini sudah dijawab.");
      }
      const answer: InterviewAnswer = {
        id: `50000000-0000-4000-8000-${String(nextAnswerId++).padStart(12, "0")}`,
        answerText,
        submittedAt: new Date().toISOString(),
        evaluation: {
          score: Math.round(
            (Object.values(evaluation.dimensions).reduce(
              (total, dimension) => total + dimension.score,
              0,
            ) /
              4) *
              20,
          ),
          evaluatedAt: new Date().toISOString(),
          result: evaluation,
        },
      };
      question.answer = answer;
      return answer;
    },
    async markCompleted(id, applicantId) {
      const record = sessions.find(
        (item) =>
          item.id === id &&
          item.applicantId === applicantId &&
          item.status === "IN_PROGRESS",
      );
      if (!record) {
        return false;
      }
      record.status = "COMPLETED";
      return true;
    },
  };
}

function createHarness(options?: {
  aiProvider?: InterviewAiProviderContract;
  configured?: boolean;
}) {
  const repository = createMemoryRepository();
  const calls = { generateQuestions: 0, evaluateAnswer: 0 };
  const aiProvider: InterviewAiProviderContract =
    options?.aiProvider ?? {
      isConfigured: () => options?.configured ?? true,
      async generateQuestions() {
        calls.generateQuestions += 1;
        return generatedQuestions;
      },
      async evaluateAnswer() {
        calls.evaluateAnswer += 1;
        return evaluationResult;
      },
    };
  const service = new InterviewSessionsService(repository, aiProvider);
  const authService = {
    register: async (_input: RegisterInput) => {},
    login: async (_input: LoginInput) => {
      throw new Error("login not used in interview tests");
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
  return { repository, service, authService, calls };
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
      undefined,
      undefined,
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

async function postJson(
  url: string,
  token: string,
  body: unknown,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { ...auth(token), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("applicant creates five relevant questions and reads private session history", async () => {
  const harness = createHarness();
  await withServer(harness, async (baseUrl) => {
    const response = await postJson(
      `${baseUrl}/api/interview-sessions`,
      "applicant-a-token",
      { jobTitle: "Backend Engineer" },
    );
    assert.equal(response.status, 201);
    const body = (await response.json()) as {
      data: InterviewSession;
    };
    assert.equal(body.data.questions.length, 5);
    assert.equal(body.data.status, "IN_PROGRESS");
    assert.equal(body.data.jobTitle, "Backend Engineer");
    assert.ok(!JSON.stringify(body).includes(applicantAProfileId));

    const listResponse = await fetch(
      `${baseUrl}/api/interview-sessions?page=1&pageSize=10`,
      { headers: auth("applicant-a-token") },
    );
    assert.equal(listResponse.status, 200);
    const listBody = (await listResponse.json()) as {
      data: { sessions: InterviewSession[]; pagination: { total: number } };
    };
    assert.equal(listBody.data.pagination.total, 1);
    assert.equal(listBody.data.sessions[0]?.id, body.data.id);

    const foreignResponse = await fetch(
      `${baseUrl}/api/interview-sessions/${body.data.id}`,
      { headers: auth("applicant-b-token") },
    );
    assert.equal(foreignResponse.status, 404);
  });
});

test("applicant answers are evaluated once, only for their session questions, and sessions complete after all answers", async () => {
  const harness = createHarness();
  await withServer(harness, async (baseUrl) => {
    const createResponse = await postJson(
      `${baseUrl}/api/interview-sessions`,
      "applicant-a-token",
      { jobTitle: "Product Designer" },
    );
    const created = (await createResponse.json()) as {
      data: InterviewSession;
    };
    const firstQuestion = created.data.questions[0]!;

    const wrongQuestionResponse = await postJson(
      `${baseUrl}/api/interview-sessions/${created.data.id}/answers`,
      "applicant-a-token",
      {
        questionId: "40000000-0000-4000-8000-000000000099",
        answerText: "A thoughtful response to the interview question.",
      },
    );
    assert.equal(wrongQuestionResponse.status, 404);

    const earlyCompleteResponse = await postJson(
      `${baseUrl}/api/interview-sessions/${created.data.id}/complete`,
      "applicant-a-token",
      {},
    );
    assert.equal(earlyCompleteResponse.status, 409);

    const answerResponse = await postJson(
      `${baseUrl}/api/interview-sessions/${created.data.id}/answers`,
      "applicant-a-token",
      {
        questionId: firstQuestion.id,
        answerText: "I clarified the requirements and delivered a measurable result.",
      },
    );
    assert.equal(answerResponse.status, 200);
    const answerBody = (await answerResponse.json()) as {
      data: { answer: InterviewAnswer };
    };
    assert.equal(answerBody.data.answer.evaluation?.result.dimensions.relevance.score, 4);

    const duplicateResponse = await postJson(
      `${baseUrl}/api/interview-sessions/${created.data.id}/answers`,
      "applicant-a-token",
      {
        questionId: firstQuestion.id,
        answerText: "A second response that must not be stored.",
      },
    );
    assert.equal(duplicateResponse.status, 409);

    for (const question of created.data.questions.slice(1)) {
      const response = await postJson(
        `${baseUrl}/api/interview-sessions/${created.data.id}/answers`,
        "applicant-a-token",
        {
          questionId: question.id,
          answerText: "I explained the approach, collaboration, and outcome clearly.",
        },
      );
      assert.equal(response.status, 200);
    }

    const completeResponse = await postJson(
      `${baseUrl}/api/interview-sessions/${created.data.id}/complete`,
      "applicant-a-token",
      {},
    );
    assert.equal(completeResponse.status, 200);
    const completed = (await completeResponse.json()) as {
      data: { session: InterviewSession; summary: InterviewSession["summary"] };
    };
    assert.equal(completed.data.session.status, "COMPLETED");
    assert.equal(completed.data.summary?.answeredQuestions, 5);
    assert.equal(completed.data.summary?.totalQuestions, 5);

    const postCompletionAnswer = await postJson(
      `${baseUrl}/api/interview-sessions/${created.data.id}/answers`,
      "applicant-a-token",
      {
        questionId: created.data.questions[0]!.id,
        answerText: "This answer cannot be submitted after completion.",
      },
    );
    assert.equal(postCompletionAnswer.status, 409);
    assert.equal(harness.calls.evaluateAnswer, 5);
  });
});

test("interview routes require authentication and APPLICANT role", async () => {
  const harness = createHarness();
  await withServer(harness, async (baseUrl) => {
    const unauthenticated = await fetch(
      `${baseUrl}/api/interview-sessions`,
    );
    assert.equal(unauthenticated.status, 401);

    const company = await postJson(
      `${baseUrl}/api/interview-sessions`,
      "company-token",
      { jobTitle: "Backend Engineer" },
    );
    assert.equal(company.status, 403);
    assert.equal(harness.repository.sessions.length, 0);
  });
});

test("invalid inputs and AI failures do not create or fabricate sessions", async () => {
  const invalidHarness = createHarness();
  await withServer(invalidHarness, async (baseUrl) => {
    const invalid = await postJson(
      `${baseUrl}/api/interview-sessions`,
      "applicant-a-token",
      { jobTitle: " " },
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalidHarness.repository.sessions.length, 0);
  });

  const unconfiguredHarness = createHarness({ configured: false });
  await withServer(unconfiguredHarness, async (baseUrl) => {
    const response = await postJson(
      `${baseUrl}/api/interview-sessions`,
      "applicant-a-token",
      { jobTitle: "Backend Engineer" },
    );
    assert.equal(response.status, 503);
    assert.equal(unconfiguredHarness.repository.sessions.length, 0);
  });

  const unavailableProvider: InterviewAiProviderContract = {
    isConfigured: () => true,
    async generateQuestions() {
      throw new HttpError(429, "Kuota Gemini sedang terbatas.");
    },
    async evaluateAnswer() {
      throw new HttpError(503, "Gemini gagal mengevaluasi jawaban.");
    },
  };
  const failedHarness = createHarness({ aiProvider: unavailableProvider });
  await withServer(failedHarness, async (baseUrl) => {
    const response = await postJson(
      `${baseUrl}/api/interview-sessions`,
      "applicant-a-token",
      { jobTitle: "Backend Engineer" },
    );
    assert.equal(response.status, 429);
    assert.equal(failedHarness.repository.sessions.length, 0);
  });
});

test("daily session quota and evaluation failures are enforced", async () => {
  const quotaHarness = createHarness();
  await withServer(quotaHarness, async (baseUrl) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await postJson(
        `${baseUrl}/api/interview-sessions`,
        "applicant-a-token",
        { jobTitle: "Backend Engineer" },
      );
      assert.equal(response.status, 201);
    }
    const limited = await postJson(
      `${baseUrl}/api/interview-sessions`,
      "applicant-a-token",
      { jobTitle: "Backend Engineer" },
    );
    assert.equal(limited.status, 429);
    assert.equal(quotaHarness.calls.generateQuestions, 2);
  });

  const failedEvaluationProvider: InterviewAiProviderContract = {
    isConfigured: () => true,
    async generateQuestions() {
      return generatedQuestions;
    },
    async evaluateAnswer() {
      throw new HttpError(503, "Gemini gagal mengevaluasi jawaban.");
    },
  };
  const failedHarness = createHarness({ aiProvider: failedEvaluationProvider });
  await withServer(failedHarness, async (baseUrl) => {
    const createResponse = await postJson(
      `${baseUrl}/api/interview-sessions`,
      "applicant-a-token",
      { jobTitle: "Backend Engineer" },
    );
    const created = (await createResponse.json()) as {
      data: InterviewSession;
    };
    const answerResponse = await postJson(
      `${baseUrl}/api/interview-sessions/${created.data.id}/answers`,
      "applicant-a-token",
      {
        questionId: created.data.questions[0]!.id,
        answerText: "A measured response that describes a relevant outcome.",
      },
    );
    assert.equal(answerResponse.status, 503);
    const detailResponse = await fetch(
      `${baseUrl}/api/interview-sessions/${created.data.id}`,
      { headers: auth("applicant-a-token") },
    );
    const detail = (await detailResponse.json()) as {
      data: InterviewSession;
    };
    assert.equal(detail.data.questions[0]?.answer, null);
  });
});

test("Gemini interview provider validates structured questions and feedback with a mock", async () => {
  const requests: RequestInit[] = [];
  const responses = [
    { questions: generatedQuestions.questions },
    evaluationResult,
  ];
  const generator = new GeminiJsonGenerator(
    "mock-key",
    "gemini-flash-test",
    async (_input, init) => {
      requests.push(init ?? {});
      const result = responses.shift();
      assert.ok(result);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(result) }],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );
  const provider = new GeminiInterviewProvider(generator);
  const questions = await provider.generateQuestions("Backend Engineer");
  const evaluation = await provider.evaluateAnswer(
    "Backend Engineer",
    generatedQuestions.questions[0]!,
    "I delivered a measurable outcome after clarifying the requirements.",
  );
  assert.equal(questions.questions.length, 5);
  assert.equal(evaluation.dimensions.completeness.score, 3);
  assert.equal(requests.length, 2);
  const headers = new Headers(requests[0]?.headers);
  assert.equal(headers.get("x-goog-api-key"), "mock-key");
  const firstBody = JSON.parse(String(requests[0]?.body)) as {
    contents: Array<{ parts: Array<{ text: string }> }>;
  };
  assert.match(firstBody.contents[0]!.parts[0]!.text, /UNTRUSTED_JOB_POSITION/);
});

test("malformed Gemini JSON fails explicitly", async () => {
  const provider = new GeminiInterviewProvider(
    new GeminiJsonGenerator("mock-key", "gemini-flash-test", async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "{bad json" }] } }],
        }),
        { status: 200 },
      ),
    ),
  );
  await assert.rejects(
    provider.generateQuestions("Backend Engineer"),
    (error: unknown) =>
      error instanceof HttpError && error.status === 503,
  );
});
