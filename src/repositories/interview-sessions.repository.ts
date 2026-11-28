import { getSupabaseAdminClient } from "../config/supabaseAdmin.js";
import type {
  InterviewAnswer,
  InterviewSession,
  InterviewSessionPage,
  InterviewSummary,
} from "../types/interview-sessions.types.js";
import type {
  InterviewEvaluationResult,
  InterviewSessionListQuery,
  SpeechDeliveryMetrics,
} from "../validators/interview-sessions.validator.js";
import {
  interviewQuestionsResultSchema,
  interviewSessionIdSchema,
  storedInterviewEvaluationSchema,
} from "../validators/interview-sessions.validator.js";
import { HttpError } from "../utils/httpError.js";

export interface InterviewSessionsRepositoryContract {
  findApplicantProfileId(userId: string): Promise<string | null>;
  countSince(applicantId: string, since: string): Promise<number>;
  createWithQuestions(
    applicantId: string,
    jobTitle: string,
    questions: string[],
  ): Promise<InterviewSession>;
  list(
    applicantId: string,
    query: InterviewSessionListQuery,
  ): Promise<InterviewSessionPage>;
  findById(id: string, applicantId: string): Promise<InterviewSession | null>;
  findQuestion(
    sessionId: string,
    questionId: string,
  ): Promise<{ id: string; questionText: string } | null>;
  hasAnswer(questionId: string): Promise<boolean>;
  createAnswerWithEvaluation(
    questionId: string,
    answerText: string,
    evaluation: InterviewEvaluationResult,
    speechMetrics?: SpeechDeliveryMetrics,
  ): Promise<InterviewAnswer>;
  markCompleted(id: string, applicantId: string): Promise<boolean>;
}

const sessionColumns =
  "id, applicant_id, job_context, status, started_at, questions(id, question_text, sequence_number, answers(id, answer_text, submitted_at, evaluations(id, score, recommendations, evaluated_at)))";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function databaseError(message: string): never {
  throw new HttpError(503, message);
}

async function executeDatabaseRequest<T>(
  createRequest: () => PromiseLike<T>,
  message: string,
): Promise<T> {
  try {
    return await createRequest();
  } catch {
    databaseError(message);
  }
}

function asString(value: unknown, message: string): string {
  if (typeof value !== "string") {
    databaseError(message);
  }
  return value;
}

function asNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    databaseError(message);
  }
  return value;
}

function relationRows(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null) {
    return [];
  }
  return isRecord(value) ? [value] : null;
}

export function hasValidPersistedQuestionSet(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !interviewSessionIdSchema.safeParse(value.id).success ||
    !Array.isArray(value.questions) ||
    value.questions.length !== 5
  ) {
    return false;
  }

  const questions: Array<{
    id: string;
    questionText: string;
    sequenceNumber: number;
  }> = [];
  for (const question of value.questions) {
    if (
      !isRecord(question) ||
      typeof question.id !== "string" ||
      typeof question.question_text !== "string" ||
      typeof question.sequence_number !== "number"
    ) {
      return false;
    }
    questions.push({
      id: question.id,
      questionText: question.question_text,
      sequenceNumber: question.sequence_number,
    });
  }

  questions.sort((left, right) => left.sequenceNumber - right.sequenceNumber);
  return (
    questions.every(
      (question, index) =>
        interviewSessionIdSchema.safeParse(question.id).success &&
        question.sequenceNumber === index + 1,
    ) &&
    interviewQuestionsResultSchema.safeParse({
      questions: questions.map((question) => question.questionText),
    }).success
  );
}

function parseEvaluation(value: unknown): InterviewAnswer["evaluation"] {
  if (!isRecord(value)) {
    databaseError("Data evaluasi wawancara tidak valid.");
  }
  const score = asNumber(value.score, "Data evaluasi wawancara tidak valid.");
  const recommendations = asString(
    value.recommendations,
    "Data evaluasi wawancara tidak valid.",
  );
  let storedJson: unknown;
  try {
    storedJson = JSON.parse(recommendations);
  } catch {
    databaseError("Data evaluasi wawancara tidak valid.");
  }
  const parsedStoredResult =
    storedInterviewEvaluationSchema.safeParse(storedJson);
  if (!parsedStoredResult.success) {
    databaseError("Data evaluasi wawancara tidak valid.");
  }
  let evaluationResult: InterviewEvaluationResult;
  let speechMetrics: SpeechDeliveryMetrics | undefined;
  if ("evaluation" in parsedStoredResult.data) {
    evaluationResult = parsedStoredResult.data.evaluation;
    speechMetrics = parsedStoredResult.data.speechMetrics;
  } else {
    evaluationResult = parsedStoredResult.data;
  }
  return {
    score,
    evaluatedAt: asString(
      value.evaluated_at,
      "Data evaluasi wawancara tidak valid.",
    ),
    result: evaluationResult,
    ...(speechMetrics ? { speechMetrics } : {}),
  };
}

function buildSummary(
  questions: InterviewSession["questions"],
): InterviewSession["summary"] {
  const completedAnswers = questions.flatMap((question) =>
    question.answer?.evaluation ? [question.answer.evaluation] : [],
  );
  if (completedAnswers.length === 0) {
    return null;
  }
  const average = (values: number[]) =>
    Math.round(
      (values.reduce((sum, value) => sum + value, 0) / values.length) * 10,
    ) / 10;
  const dimensionAverages: InterviewSummary["dimensionAverages"] = {
    relevance: average(
      completedAnswers.map(
        (evaluation) => evaluation.result.dimensions.relevance.score,
      ),
    ),
    clarity: average(
      completedAnswers.map(
        (evaluation) => evaluation.result.dimensions.clarity.score,
      ),
    ),
    completeness: average(
      completedAnswers.map(
        (evaluation) => evaluation.result.dimensions.completeness.score,
      ),
    ),
    delivery: average(
      completedAnswers.map(
        (evaluation) => evaluation.result.dimensions.delivery.score,
      ),
    ),
  };
  return {
    answeredQuestions: completedAnswers.length,
    totalQuestions: questions.length,
    averageScore: average(completedAnswers.map((evaluation) => evaluation.score)),
    dimensionAverages,
    improvementTips: [
      ...new Set(
        completedAnswers.flatMap(
          (evaluation) => evaluation.result.improvementTips,
        ),
      ),
    ].slice(0, 5),
  };
}

export function mapInterviewSessionRow(value: unknown): InterviewSession {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.job_context !== "string" ||
    typeof value.status !== "string" ||
    typeof value.started_at !== "string" ||
    !Array.isArray(value.questions)
  ) {
    databaseError("Data sesi wawancara tidak valid.");
  }

  const questions = value.questions.map((question): InterviewSession["questions"][number] => {
    const answers = isRecord(question)
      ? relationRows(question.answers)
      : null;
    if (
      !isRecord(question) ||
      typeof question.id !== "string" ||
      typeof question.question_text !== "string" ||
      typeof question.sequence_number !== "number" ||
      !answers
    ) {
      databaseError("Data pertanyaan wawancara tidak valid.");
    }

    if (answers.length > 1) {
      databaseError("Ditemukan jawaban duplikat pada sesi wawancara.");
    }
    let answer: InterviewSession["questions"][number]["answer"] = null;
    const rawAnswer = answers[0];
    if (rawAnswer !== undefined) {
      const evaluations = isRecord(rawAnswer)
        ? relationRows(rawAnswer.evaluations)
        : null;
      if (
        !isRecord(rawAnswer) ||
        typeof rawAnswer.id !== "string" ||
        typeof rawAnswer.answer_text !== "string" ||
        typeof rawAnswer.submitted_at !== "string" ||
        !evaluations ||
        evaluations.length > 1
      ) {
        databaseError("Data jawaban wawancara tidak valid.");
      }
      const rawEvaluation = evaluations[0];
      answer = {
        id: rawAnswer.id,
        answerText: rawAnswer.answer_text,
        submittedAt: rawAnswer.submitted_at,
        evaluation:
          rawEvaluation === undefined ? null : parseEvaluation(rawEvaluation),
      };
    }

    return {
      id: question.id,
      questionText: question.question_text,
      sequenceNumber: question.sequence_number,
      answer,
    };
  });

  questions.sort((left, right) => left.sequenceNumber - right.sequenceNumber);
  return {
    id: value.id,
    jobTitle: value.job_context,
    status: value.status,
    startedAt: value.started_at,
    questions,
    summary: value.status === "COMPLETED" ? buildSummary(questions) : null,
  };
}

function overallScore(evaluation: InterviewEvaluationResult): number {
  const dimensions = Object.values(evaluation.dimensions);
  return Math.round(
    (dimensions.reduce((total, dimension) => total + dimension.score, 0) /
      dimensions.length) *
      20,
  );
}

export class SupabaseInterviewSessionsRepository
  implements InterviewSessionsRepositoryContract
{
  async findApplicantProfileId(userId: string): Promise<string | null> {
    const { data, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("applicant_profiles")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle(),
      "Profil applicant tidak dapat diproses.",
    );
    if (
      error ||
      (data !== null &&
        (!isRecord(data) || typeof data.id !== "string"))
    ) {
      databaseError("Profil applicant tidak dapat diambil.");
    }
    return data ? data.id : null;
  }

  async countSince(applicantId: string, since: string): Promise<number> {
    const pageSize = 500;
    let offset = 0;
    let validSessionCount = 0;
    while (true) {
      const { data, error } = await executeDatabaseRequest(
        () =>
          getSupabaseAdminClient()
            .from("interview_sessions")
            .select("id, questions(id, question_text, sequence_number)")
            .eq("applicant_id", applicantId)
            .gte("started_at", since)
            .order("started_at", { ascending: true })
            .order("id", { ascending: true })
            .range(offset, offset + pageSize - 1),
        "Riwayat wawancara tidak dapat diproses.",
      );
      if (error || !Array.isArray(data)) {
        databaseError("Riwayat wawancara tidak dapat dihitung.");
      }

      validSessionCount += data.filter(hasValidPersistedQuestionSet).length;
      if (data.length < pageSize) {
        return validSessionCount;
      }
      offset += pageSize;
    }
  }

  async createWithQuestions(
    applicantId: string,
    jobTitle: string,
    questions: string[],
  ): Promise<InterviewSession> {
    const { data: session, error: sessionError } =
      await executeDatabaseRequest(
        () =>
          getSupabaseAdminClient()
            .from("interview_sessions")
            .insert({
              applicant_id: applicantId,
              job_context: jobTitle,
              status: "IN_PROGRESS",
            })
            .select("id")
            .single(),
        "Sesi wawancara tidak dapat dibuat.",
      );
    if (sessionError || !isRecord(session) || typeof session.id !== "string") {
      databaseError("Sesi wawancara tidak dapat dibuat.");
    }

    const { error: questionError } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("questions")
          .insert(
            questions.map((questionText, index) => ({
              session_id: session.id,
              question_text: questionText,
              sequence_number: index + 1,
            })),
          ),
      "Pertanyaan wawancara tidak dapat disimpan.",
    );
    if (questionError) {
      databaseError("Pertanyaan wawancara tidak dapat disimpan.");
    }

    const created = await this.findById(session.id, applicantId);
    if (!created) {
      databaseError("Sesi wawancara yang dibuat tidak dapat dibaca.");
    }
    if (
      !interviewQuestionsResultSchema.safeParse({
        questions: created.questions.map((question) => question.questionText),
      }).success ||
      created.questions.some(
        (question, index) =>
          !interviewSessionIdSchema.safeParse(question.id).success ||
          question.sequenceNumber !== index + 1 ||
          question.answer !== null,
      )
    ) {
      databaseError("Data pertanyaan wawancara tidak valid.");
    }
    return created;
  }

  async list(
    applicantId: string,
    query: InterviewSessionListQuery,
  ): Promise<InterviewSessionPage> {
    const { data, error, count } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("interview_sessions")
          .select(sessionColumns, { count: "exact" })
          .eq("applicant_id", applicantId)
          .order("started_at", { ascending: false })
          .order("id", { ascending: false })
          .range(
            (query.page - 1) * query.pageSize,
            query.page * query.pageSize - 1,
          ),
      "Riwayat wawancara tidak dapat diproses.",
    );
    if (error || !Array.isArray(data) || count === null) {
      databaseError("Riwayat wawancara tidak dapat diambil.");
    }
    return { sessions: data.map(mapInterviewSessionRow), total: count };
  }

  async findById(
    id: string,
    applicantId: string,
  ): Promise<InterviewSession | null> {
    const { data, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("interview_sessions")
          .select(sessionColumns)
          .eq("id", id)
          .eq("applicant_id", applicantId)
          .maybeSingle(),
      "Sesi wawancara tidak dapat diproses.",
    );
    if (error) {
      databaseError("Sesi wawancara tidak dapat diambil.");
    }
    return data ? mapInterviewSessionRow(data) : null;
  }

  async findQuestion(
    sessionId: string,
    questionId: string,
  ): Promise<{ id: string; questionText: string } | null> {
    const { data, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("questions")
          .select("id, question_text")
          .eq("session_id", sessionId)
          .eq("id", questionId)
          .maybeSingle(),
      "Pertanyaan wawancara tidak dapat diproses.",
    );
    if (error) {
      databaseError("Pertanyaan wawancara tidak dapat diambil.");
    }
    if (!data) {
      return null;
    }
    if (!isRecord(data) || typeof data.id !== "string" || typeof data.question_text !== "string") {
      databaseError("Data pertanyaan wawancara tidak valid.");
    }
    return { id: data.id, questionText: data.question_text };
  }

  async hasAnswer(questionId: string): Promise<boolean> {
    const { data, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("answers")
          .select("id")
          .eq("question_id", questionId)
          .limit(1)
          .maybeSingle(),
      "Jawaban wawancara tidak dapat diproses.",
    );
    if (error) {
      databaseError("Jawaban wawancara tidak dapat diperiksa.");
    }
    return data !== null;
  }

  async createAnswerWithEvaluation(
    questionId: string,
    answerText: string,
    evaluation: InterviewEvaluationResult,
    speechMetrics?: SpeechDeliveryMetrics,
  ): Promise<InterviewAnswer> {
    const { data: answer, error: answerError } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("answers")
          .insert({ question_id: questionId, answer_text: answerText })
          .select("id, answer_text, submitted_at")
          .single(),
      "Jawaban wawancara tidak dapat disimpan.",
    );
    if (
      answerError ||
      !isRecord(answer) ||
      typeof answer.id !== "string" ||
      typeof answer.answer_text !== "string" ||
      typeof answer.submitted_at !== "string"
    ) {
      if (
        isRecord(answerError) &&
        answerError.code === "23505"
      ) {
        throw new HttpError(409, "Pertanyaan ini sudah dijawab.");
      }
      databaseError("Jawaban wawancara tidak dapat disimpan.");
    }

    let evaluationData: unknown;
    try {
      const result = await executeDatabaseRequest(
        () =>
          getSupabaseAdminClient()
            .from("evaluations")
            .insert({
              answer_id: answer.id,
              score: overallScore(evaluation),
              recommendations: JSON.stringify(
                speechMetrics
                  ? { evaluation, speechMetrics }
                  : evaluation,
              ),
            })
            .select("id, evaluated_at")
            .single(),
        "Evaluasi wawancara tidak dapat disimpan.",
      );
      if (
        result.error ||
        !isRecord(result.data) ||
        typeof result.data.id !== "string" ||
        typeof result.data.evaluated_at !== "string"
      ) {
        databaseError("Evaluasi wawancara tidak dapat disimpan.");
      }
      evaluationData = result.data;
    } catch {
      const { error: cleanupError } = await executeDatabaseRequest(
        () =>
          getSupabaseAdminClient()
            .from("answers")
            .delete()
            .eq("id", answer.id),
        "Jawaban gagal dibersihkan setelah penyimpanan evaluasi gagal.",
      );
      if (cleanupError) {
        databaseError(
          "Evaluasi gagal disimpan dan jawaban tidak dapat dibersihkan.",
        );
      }
      databaseError("Evaluasi wawancara tidak dapat disimpan.");
    }

    if (
      !isRecord(evaluationData) ||
      typeof evaluationData.evaluated_at !== "string"
    ) {
      databaseError("Evaluasi wawancara tidak valid.");
    }
    return {
      id: answer.id,
      answerText: answer.answer_text,
      submittedAt: answer.submitted_at,
      evaluation: {
        score: overallScore(evaluation),
        evaluatedAt: evaluationData.evaluated_at,
        result: evaluation,
        ...(speechMetrics ? { speechMetrics } : {}),
      },
    };
  }

  async markCompleted(id: string, applicantId: string): Promise<boolean> {
    const { data, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("interview_sessions")
          .update({ status: "COMPLETED" })
          .eq("id", id)
          .eq("applicant_id", applicantId)
          .eq("status", "IN_PROGRESS")
          .select("id")
          .maybeSingle(),
      "Sesi wawancara tidak dapat diselesaikan.",
    );
    if (error) {
      databaseError("Sesi wawancara tidak dapat diselesaikan.");
    }
    return data !== null;
  }
}
