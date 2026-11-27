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
} from "../validators/interview-sessions.validator.js";
import { interviewEvaluationResultSchema } from "../validators/interview-sessions.validator.js";
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

function parseEvaluation(value: unknown): InterviewAnswer["evaluation"] {
  if (!isRecord(value)) {
    databaseError("Data evaluasi wawancara tidak valid.");
  }
  const score = asNumber(value.score, "Data evaluasi wawancara tidak valid.");
  const recommendations = asString(
    value.recommendations,
    "Data evaluasi wawancara tidak valid.",
  );
  let result: unknown;
  try {
    result = JSON.parse(recommendations);
  } catch {
    databaseError("Data evaluasi wawancara tidak valid.");
  }
  const parsedResult = interviewEvaluationResultSchema.safeParse(result);
  if (!parsedResult.success) {
    databaseError("Data evaluasi wawancara tidak valid.");
  }
  return {
    score,
    evaluatedAt: asString(
      value.evaluated_at,
      "Data evaluasi wawancara tidak valid.",
    ),
    result: parsedResult.data,
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

function toSession(value: unknown): InterviewSession {
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
    if (
      !isRecord(question) ||
      typeof question.id !== "string" ||
      typeof question.question_text !== "string" ||
      typeof question.sequence_number !== "number" ||
      !Array.isArray(question.answers)
    ) {
      databaseError("Data pertanyaan wawancara tidak valid.");
    }

    if (question.answers.length > 1) {
      databaseError("Ditemukan jawaban duplikat pada sesi wawancara.");
    }
    let answer: InterviewSession["questions"][number]["answer"] = null;
    const rawAnswer = question.answers[0];
    if (rawAnswer !== undefined) {
      if (
        !isRecord(rawAnswer) ||
        typeof rawAnswer.id !== "string" ||
        typeof rawAnswer.answer_text !== "string" ||
        typeof rawAnswer.submitted_at !== "string" ||
        !Array.isArray(rawAnswer.evaluations) ||
        rawAnswer.evaluations.length > 1
      ) {
        databaseError("Data jawaban wawancara tidak valid.");
      }
      const rawEvaluation = rawAnswer.evaluations[0];
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
    const { count, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("interview_sessions")
          .select("id", { count: "exact", head: true })
          .eq("applicant_id", applicantId)
          .gte("started_at", since),
      "Riwayat wawancara tidak dapat diproses.",
    );
    if (error || count === null) {
      databaseError("Riwayat wawancara tidak dapat dihitung.");
    }
    return count;
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
      const { error: rollbackError } = await executeDatabaseRequest(
        () =>
          getSupabaseAdminClient()
            .from("interview_sessions")
            .delete()
            .eq("id", session.id)
            .eq("applicant_id", applicantId),
        "Sesi wawancara gagal dibersihkan setelah penyimpanan pertanyaan gagal.",
      );
      if (rollbackError) {
        databaseError(
          "Pertanyaan gagal disimpan dan sesi wawancara tidak dapat dibersihkan.",
        );
      }
      databaseError("Pertanyaan wawancara tidak dapat disimpan.");
    }

    const created = await this.findById(session.id, applicantId);
    if (!created) {
      databaseError("Sesi wawancara yang dibuat tidak dapat dibaca.");
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
    return { sessions: data.map(toSession), total: count };
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
    return data ? toSession(data) : null;
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
              recommendations: JSON.stringify(evaluation),
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
