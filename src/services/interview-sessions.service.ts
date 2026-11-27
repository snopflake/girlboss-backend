import type {
  InterviewSessionsRepositoryContract,
} from "../repositories/interview-sessions.repository.js";
import type {
  InterviewAnswer,
  InterviewSession,
  InterviewSessionPage,
} from "../types/interview-sessions.types.js";
import type {
  CreateInterviewSessionInput,
  InterviewAnswerInput,
  InterviewSessionListQuery,
} from "../validators/interview-sessions.validator.js";
import type { InterviewAiProviderContract } from "./gemini-interview-provider.js";
import { HttpError } from "../utils/httpError.js";

export const MAX_INTERVIEW_SESSIONS_PER_24_HOURS = 2;
const INTERVIEW_SESSION_WINDOW_MS = 24 * 60 * 60 * 1_000;

export interface InterviewSessionsServiceContract {
  create(
    userId: string,
    input: CreateInterviewSessionInput,
  ): Promise<InterviewSession>;
  list(
    userId: string,
    query: InterviewSessionListQuery,
  ): Promise<InterviewSessionPage>;
  get(userId: string, id: string): Promise<InterviewSession>;
  submitAnswer(
    userId: string,
    id: string,
    input: InterviewAnswerInput,
  ): Promise<InterviewAnswer>;
  complete(userId: string, id: string): Promise<InterviewSession>;
}

export class InterviewSessionsService
  implements InterviewSessionsServiceContract
{
  constructor(
    private readonly repository: InterviewSessionsRepositoryContract,
    private readonly aiProvider: InterviewAiProviderContract,
  ) {}

  async create(
    userId: string,
    input: CreateInterviewSessionInput,
  ): Promise<InterviewSession> {
    if (!this.aiProvider.isConfigured()) {
      throw new HttpError(
        503,
        "AI Interview Preparation belum dikonfigurasi di backend.",
      );
    }
    const applicantId = await this.getApplicantProfileId(userId);
    const since = new Date(
      Date.now() - INTERVIEW_SESSION_WINDOW_MS,
    ).toISOString();
    const sessionCount = await this.repository.countSince(applicantId, since);
    if (sessionCount >= MAX_INTERVIEW_SESSIONS_PER_24_HOURS) {
      throw new HttpError(
        429,
        "Batas sesi wawancara 24 jam terakhir telah tercapai.",
      );
    }

    const generated = await this.aiProvider.generateQuestions(input.jobTitle);
    return this.repository.createWithQuestions(
      applicantId,
      input.jobTitle,
      generated.questions,
    );
  }

  async list(
    userId: string,
    query: InterviewSessionListQuery,
  ): Promise<InterviewSessionPage> {
    const applicantId = await this.getApplicantProfileId(userId);
    return this.repository.list(applicantId, query);
  }

  async get(userId: string, id: string): Promise<InterviewSession> {
    const applicantId = await this.getApplicantProfileId(userId);
    const session = await this.repository.findById(id, applicantId);
    if (!session) {
      throw new HttpError(404, "Sesi wawancara tidak ditemukan.");
    }
    return session;
  }

  async submitAnswer(
    userId: string,
    id: string,
    input: InterviewAnswerInput,
  ): Promise<InterviewAnswer> {
    const applicantId = await this.getApplicantProfileId(userId);
    const session = await this.repository.findById(id, applicantId);
    if (!session) {
      throw new HttpError(404, "Sesi wawancara tidak ditemukan.");
    }
    if (session.status !== "IN_PROGRESS") {
      throw new HttpError(409, "Sesi wawancara sudah selesai.");
    }

    const question = await this.repository.findQuestion(id, input.questionId);
    if (!question) {
      throw new HttpError(404, "Pertanyaan tidak ditemukan pada sesi ini.");
    }
    if (await this.repository.hasAnswer(question.id)) {
      throw new HttpError(409, "Pertanyaan ini sudah dijawab.");
    }

    const evaluation = await this.aiProvider.evaluateAnswer(
      session.jobTitle,
      question.questionText,
      input.answerText,
    );

    const latestSession = await this.repository.findById(id, applicantId);
    if (!latestSession || latestSession.status !== "IN_PROGRESS") {
      throw new HttpError(409, "Sesi wawancara sudah selesai.");
    }
    if (await this.repository.hasAnswer(question.id)) {
      throw new HttpError(409, "Pertanyaan ini sudah dijawab.");
    }

    return this.repository.createAnswerWithEvaluation(
      question.id,
      input.answerText,
      evaluation,
    );
  }

  async complete(userId: string, id: string): Promise<InterviewSession> {
    const applicantId = await this.getApplicantProfileId(userId);
    const session = await this.repository.findById(id, applicantId);
    if (!session) {
      throw new HttpError(404, "Sesi wawancara tidak ditemukan.");
    }
    if (session.status === "COMPLETED") {
      return session;
    }
    if (session.status !== "IN_PROGRESS") {
      throw new HttpError(409, "Status sesi wawancara tidak dapat diselesaikan.");
    }
    if (
      session.questions.length !== 5 ||
      session.questions.some(
        (question) => !question.answer?.evaluation,
      )
    ) {
      throw new HttpError(
        409,
        "Jawab dan selesaikan evaluasi untuk semua pertanyaan terlebih dahulu.",
      );
    }

    const updated = await this.repository.markCompleted(id, applicantId);
    if (!updated) {
      const current = await this.repository.findById(id, applicantId);
      if (current?.status === "COMPLETED") {
        return current;
      }
      throw new HttpError(409, "Sesi wawancara berubah dan belum dapat selesai.");
    }

    const completed = await this.repository.findById(id, applicantId);
    if (!completed) {
      throw new HttpError(503, "Sesi wawancara selesai tetapi tidak dapat dibaca.");
    }
    return completed;
  }

  private async getApplicantProfileId(userId: string): Promise<string> {
    const applicantId = await this.repository.findApplicantProfileId(userId);
    if (!applicantId) {
      throw new HttpError(404, "Profil applicant tidak ditemukan.");
    }
    return applicantId;
  }
}
