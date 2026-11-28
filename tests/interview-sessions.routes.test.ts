import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import type {
  InterviewSessionsRepositoryContract,
} from "../src/repositories/interview-sessions.repository.js";
import {
  hasValidPersistedQuestionSet,
  mapInterviewSessionRow,
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
  InterviewAudioFile,
  InterviewAudioTranscriberContract,
  InterviewTranscription,
} from "../src/services/interview-audio.js";
import {
  GroqWhisperTranscriber,
  inspectInterviewAudio,
  MAX_INTERVIEW_AUDIO_BYTES,
} from "../src/services/interview-audio.js";
import type {
  InterviewEvaluationResult,
  InterviewQuestionsResult,
  SpeechDeliveryMetrics,
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
    "Bisakah Anda menjelaskan proyek yang relevan dengan posisi ini dan kontribusi Anda?",
    "Bagaimana Anda menentukan prioritas saat menghadapi beberapa tenggat sekaligus?",
    "Ceritakan pengalaman Anda mengatasi tantangan teknis yang tidak terduga.",
    "Bagaimana cara Anda berkolaborasi dengan rekan yang memiliki gaya kerja berbeda?",
    "Apa yang akan menjadi fokus Anda pada beberapa bulan pertama di posisi ini?",
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
          item.applicantId === applicantId &&
          item.startedAt >= since &&
          hasValidPersistedQuestionSet({
            id: item.id,
            questions: item.questions.map((question) => ({
              id: question.id,
              question_text: question.questionText,
              sequence_number: question.sequenceNumber,
            })),
          }),
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
      speechMetrics,
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
          ...(speechMetrics ? { speechMetrics } : {}),
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
  audioTranscriber?: InterviewAudioTranscriberContract;
  configured?: boolean;
}) {
  const repository = createMemoryRepository();
  const calls = { generateQuestions: 0, evaluateAnswer: 0, transcribe: 0 };
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
  const audioTranscriber: InterviewAudioTranscriberContract =
    options?.audioTranscriber ?? {
      isConfigured: () => true,
      async transcribe(_file: InterviewAudioFile): Promise<InterviewTranscription> {
        calls.transcribe += 1;
        return {
          text: "I clarified the goal and delivered a measurable result.",
          durationSeconds: 8,
          segments: [
            { start: 0, end: 2, text: "I clarified the goal" },
            { start: 3, end: 7, text: "and delivered a measurable result" },
          ],
        };
      },
    };
  const service = new InterviewSessionsService(
    repository,
    aiProvider,
    audioTranscriber,
  );
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

function audioFormData(questionId: string): FormData {
  const formData = new FormData();
  formData.append("questionId", questionId);
  formData.append(
    "audio",
    new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00])], {
      type: "audio/webm",
    }),
    "answer.webm",
  );
  return formData;
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

async function postAudio(
  url: string,
  token: string,
  questionId: string,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: auth(token),
    body: audioFormData(questionId),
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
    assert.deepEqual(
      body.data.questions.map((question) => question.sequenceNumber),
      [1, 2, 3, 4, 5],
    );
    for (const question of body.data.questions) {
      assert.match(question.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      assert.ok(question.questionText.length >= 20);
      assert.ok(question.questionText.length <= 400);
      assert.equal(question.answer, null);
    }
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

    const ownDetailResponse = await fetch(
      `${baseUrl}/api/interview-sessions/${body.data.id}`,
      { headers: auth("applicant-a-token") },
    );
    assert.equal(ownDetailResponse.status, 200);
    const ownDetail = (await ownDetailResponse.json()) as {
      data: InterviewSession;
    };
    assert.equal(ownDetail.data.questions.length, 5);
    assert.deepEqual(
      ownDetail.data.questions.map((question) => question.sequenceNumber),
      [1, 2, 3, 4, 5],
    );

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
    const companyAudio = await postAudio(
      `${baseUrl}/api/interview-sessions/30000000-0000-4000-8000-000000000001/audio-answers`,
      "company-token",
      "40000000-0000-4000-8000-000000000001",
    );
    assert.equal(companyAudio.status, 403);
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

  test("invalid AI question data is rejected before creating a session", async () => {
    const invalidProvider: InterviewAiProviderContract = {
      isConfigured: () => true,
      async generateQuestions() {
        return {
          questions: generatedQuestions.questions.slice(0, 4),
        } as InterviewQuestionsResult;
      },
      async evaluateAnswer() {
        return evaluationResult;
      },
    };
    const harness = createHarness({ aiProvider: invalidProvider });

    await withServer(harness, async (baseUrl) => {
      const response = await postJson(
        `${baseUrl}/api/interview-sessions`,
        "applicant-a-token",
        { jobTitle: "Frontend Engineer" },
      );
      const body = (await response.json()) as { message: string };

      assert.equal(response.status, 503);
      assert.match(body.message, /Format pertanyaan Gemini tidak valid/);
      assert.equal(harness.repository.sessions.length, 0);
    });
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
  await quotaHarness.repository.createWithQuestions(
    applicantAProfileId,
    "Incomplete prior session",
    generatedQuestions.questions.slice(0, 4),
  );
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

test("audio answers are transcribed, evaluated, and stored without retaining raw audio", async () => {
  const harness = createHarness();
  await withServer(harness, async (baseUrl) => {
    const createResponse = await postJson(
      `${baseUrl}/api/interview-sessions`,
      "applicant-a-token",
      { jobTitle: "Backend Engineer" },
    );
    const created = (await createResponse.json()) as {
      data: InterviewSession;
    };
    const question = created.data.questions[0]!;
    const response = await postAudio(
      `${baseUrl}/api/interview-sessions/${created.data.id}/audio-answers`,
      "applicant-a-token",
      question.id,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      data: { answer: InterviewAnswer };
    };
    assert.equal(
      body.data.answer.answerText,
      "I clarified the goal and delivered a measurable result.",
    );
    const metrics = body.data.answer.evaluation?.speechMetrics;
    assert.ok(metrics);
    const typedMetrics: SpeechDeliveryMetrics = metrics;
    assert.equal(typedMetrics.durationSeconds, 8);
    assert.equal(typedMetrics.wordsPerMinute, 67.5);
    assert.equal(typedMetrics.pauseCount, 1);
    assert.equal(typedMetrics.pitchVariation, null);
    assert.equal(typedMetrics.pitchStatus, "UNSUPPORTED_FORMAT");
    assert.equal(harness.calls.transcribe, 1);

    const detailResponse = await fetch(
      `${baseUrl}/api/interview-sessions/${created.data.id}`,
      { headers: auth("applicant-a-token") },
    );
    const detail = (await detailResponse.json()) as {
      data: InterviewSession;
    };
    assert.equal(
      detail.data.questions[0]?.answer?.evaluation?.speechMetrics?.durationSeconds,
      8,
    );
    assert.equal(
      JSON.stringify(harness.repository.sessions).includes("answer.webm"),
      false,
    );
  });
});

test("audio validation, duration limits, ownership, and duplicate protection run before provider calls", async () => {
  const harness = createHarness();
  await withServer(harness, async (baseUrl) => {
    const createResponse = await postJson(
      `${baseUrl}/api/interview-sessions`,
      "applicant-a-token",
      { jobTitle: "Backend Engineer" },
    );
    const created = (await createResponse.json()) as {
      data: InterviewSession;
    };
    const question = created.data.questions[0]!;
    const textAnswer = await postJson(
      `${baseUrl}/api/interview-sessions/${created.data.id}/answers`,
      "applicant-a-token",
      {
        questionId: question.id,
        answerText: "I explained the approach and its measurable outcome.",
      },
    );
    assert.equal(textAnswer.status, 200);

    const duplicateAudio = await postAudio(
      `${baseUrl}/api/interview-sessions/${created.data.id}/audio-answers`,
      "applicant-a-token",
      question.id,
    );
    assert.equal(duplicateAudio.status, 409);
    assert.equal(harness.calls.transcribe, 0);

    const foreignSessionAudio = await postAudio(
      `${baseUrl}/api/interview-sessions/${created.data.id}/audio-answers`,
      "applicant-b-token",
      created.data.questions[1]!.id,
    );
    assert.equal(foreignSessionAudio.status, 404);
    assert.equal(harness.calls.transcribe, 0);
  });

  const longAudioTranscriber: InterviewAudioTranscriberContract = {
    isConfigured: () => true,
    async transcribe() {
      return {
        text: "A sufficiently long answer about my work and its outcome.",
        durationSeconds: 181,
        segments: null,
      };
    },
  };
  const longAudioHarness = createHarness({
    audioTranscriber: longAudioTranscriber,
  });
  await withServer(longAudioHarness, async (baseUrl) => {
    const createResponse = await postJson(
      `${baseUrl}/api/interview-sessions`,
      "applicant-a-token",
      { jobTitle: "Backend Engineer" },
    );
    const created = (await createResponse.json()) as {
      data: InterviewSession;
    };
    const response = await postAudio(
      `${baseUrl}/api/interview-sessions/${created.data.id}/audio-answers`,
      "applicant-a-token",
      created.data.questions[0]!.id,
    );
    assert.equal(response.status, 413);
    const detail = await longAudioHarness.service.get(
      applicantAId,
      created.data.id,
    );
    assert.equal(detail.questions[0]?.answer, null);
  });
});

test("Groq Whisper uses the configured model and handles throttling without exposing provider details", async () => {
  const observedForms: FormData[] = [];
  let observedAuthorization: string | null = null;
  const transcriber = new GroqWhisperTranscriber(
    "mock-groq-key",
    "whisper-large-v3-turbo",
    async (_input, init) => {
      observedForms.push(init?.body as FormData);
      observedAuthorization = new Headers(init?.headers).get("authorization");
      return new Response(
        JSON.stringify({
          text: "A clear answer with a relevant example.",
          duration: 7.5,
          segments: [
            { start: 0, end: 2, text: "A clear answer" },
            { start: 3, end: 7, text: "with a relevant example" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );
  const file: InterviewAudioFile = {
    buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]),
    mimeType: "audio/webm",
    originalName: "answer.webm",
  };
  const transcription = await transcriber.transcribe(file);
  assert.equal(transcription.durationSeconds, 7.5);
  assert.equal(observedAuthorization, "Bearer mock-groq-key");
  const observedForm = observedForms[0];
  assert.ok(observedForm);
  assert.equal(observedForm.get("model"), "whisper-large-v3-turbo");
  assert.equal(observedForm.get("response_format"), "verbose_json");
  assert.equal(observedForm.get("timestamp_granularities[]"), "segment");

  const throttled = new GroqWhisperTranscriber(
    "mock-groq-key",
    "whisper-large-v3-turbo",
    async () => new Response("private provider details", { status: 429 }),
  );
  await assert.rejects(
    throttled.transcribe(file),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 429 &&
      !error.message.includes("private provider details"),
  );
});

test("audio MIME/signature checks reject mismatched data and enforce upload size", () => {
  assert.throws(
    () =>
      inspectInterviewAudio({
        buffer: Buffer.from("not audio"),
        mimeType: "audio/webm",
        originalName: "answer.webm",
      }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
  assert.throws(
    () =>
      inspectInterviewAudio({
        buffer: Buffer.alloc(MAX_INTERVIEW_AUDIO_BYTES + 1),
        mimeType: "audio/webm",
        originalName: "answer.webm",
      }),
    (error: unknown) => error instanceof HttpError && error.status === 413,
  );
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
    systemInstruction: { parts: Array<{ text: string }> };
    contents: Array<{ parts: Array<{ text: string }> }>;
    generationConfig: {
      maxOutputTokens: number;
      responseMimeType: string;
      responseSchema: { properties: Record<string, unknown> };
      thinkingConfig: { thinkingBudget: number };
    };
  };
  assert.match(firstBody.contents[0]!.parts[0]!.text, /Bahasa Indonesia/);
  assert.match(firstBody.contents[0]!.parts[0]!.text, /UNTRUSTED_JOB_POSITION/);
  assert.match(firstBody.systemInstruction.parts[0]!.text, /Bahasa Indonesia/);
  assert.equal(firstBody.generationConfig.maxOutputTokens, 4_096);
  assert.equal(firstBody.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(firstBody.generationConfig.thinkingConfig, {
    thinkingBudget: 0,
  });
  assert.ok("questions" in firstBody.generationConfig.responseSchema.properties);

  const secondBody = JSON.parse(String(requests[1]?.body)) as {
    systemInstruction: { parts: Array<{ text: string }> };
    contents: Array<{ parts: Array<{ text: string }> }>;
    generationConfig: {
      maxOutputTokens: number;
      thinkingConfig: { thinkingBudget: number };
    };
  };
  assert.match(secondBody.systemInstruction.parts[0]!.text, /Bahasa Indonesia/);
  assert.match(secondBody.contents[0]!.parts[0]!.text, /feedback.*Bahasa Indonesia/);
  assert.equal(secondBody.generationConfig.maxOutputTokens, 4_096);
  assert.deepEqual(secondBody.generationConfig.thinkingConfig, {
    thinkingBudget: 0,
  });
});

test("Gemini incomplete, short, and frontend-shaped question outputs are rejected", async () => {
  const invalidOutputs: unknown[] = [
    {},
    { questions: generatedQuestions.questions.slice(0, 4) },
    {
      questions: generatedQuestions.questions.map((questionText, index) => ({
        id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        questionText,
        sequenceNumber: index + 1,
        answer: null,
      })),
    },
  ];

  for (const output of invalidOutputs) {
    const provider = new GeminiInterviewProvider(
      new GeminiJsonGenerator("mock-key", "gemini-flash-test", async () =>
        Response.json({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(output) }] } },
          ],
        }),
      ),
    );

    await assert.rejects(
      provider.generateQuestions("Frontend Engineer"),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === 503 &&
        /Format pertanyaan Gemini tidak valid/.test(error.message),
    );
  }
});

test("database question relations accept singular and empty Supabase embeds", () => {
  const row = {
    id: "30000000-0000-4000-8000-000000000001",
    job_context: "Frontend Engineer",
    status: "IN_PROGRESS",
    started_at: "2026-11-28T00:00:00.000Z",
    questions: generatedQuestions.questions.map((questionText, index) => ({
      id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      question_text: questionText,
      sequence_number: index + 1,
      answers:
        index === 0
          ? {
              id: "50000000-0000-4000-8000-000000000001",
              answer_text: "Saya membangun antarmuka dengan React.",
              submitted_at: "2026-11-28T00:01:00.000Z",
              evaluations: null,
            }
          : null,
    })),
  };

  const session = mapInterviewSessionRow(row);

  assert.equal(session.questions.length, 5);
  assert.deepEqual(
    session.questions.map((question) => question.sequenceNumber),
    [1, 2, 3, 4, 5],
  );
  assert.equal(session.questions[0]?.answer?.evaluation, null);
  assert.equal(session.questions[1]?.answer, null);
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
