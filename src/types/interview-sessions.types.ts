import type {
  InterviewEvaluationResult,
  SpeechDeliveryMetrics,
} from "../validators/interview-sessions.validator.js";

export type InterviewSessionStatus = string;

export interface InterviewEvaluation {
  score: number;
  evaluatedAt: string;
  result: InterviewEvaluationResult;
  speechMetrics?: SpeechDeliveryMetrics;
}

export interface InterviewAnswer {
  id: string;
  answerText: string;
  submittedAt: string;
  evaluation: InterviewEvaluation | null;
}

export interface InterviewQuestion {
  id: string;
  questionText: string;
  sequenceNumber: number;
  answer: InterviewAnswer | null;
}

export interface InterviewSummary {
  answeredQuestions: number;
  totalQuestions: number;
  averageScore: number;
  dimensionAverages: {
    relevance: number;
    clarity: number;
    completeness: number;
    delivery: number;
  };
  improvementTips: string[];
}

export interface InterviewSession {
  id: string;
  jobTitle: string;
  status: InterviewSessionStatus;
  startedAt: string;
  questions: InterviewQuestion[];
  summary: InterviewSummary | null;
}

export interface InterviewSessionPage {
  sessions: InterviewSession[];
  total: number;
}
