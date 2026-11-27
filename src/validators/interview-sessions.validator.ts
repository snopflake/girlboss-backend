import { z } from "zod";

export const interviewSessionIdSchema = z.uuid();

export const createInterviewSessionSchema = z
  .object({
    jobTitle: z.string().trim().min(2).max(120),
  })
  .strict();

export const interviewAnswerInputSchema = z
  .object({
    questionId: z.uuid(),
    answerText: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const interviewSessionListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const interviewQuestionsResultSchema = z
  .object({
    questions: z.array(z.string().trim().min(20).max(400)).length(5),
  })
  .strict()
  .refine(
    ({ questions }) =>
      new Set(questions.map((question) => question.toLocaleLowerCase())).size ===
      5,
    "Pertanyaan harus unik.",
  );

const interviewDimensionSchema = z
  .object({
    score: z.number().int().min(0).max(5),
    feedback: z.string().trim().min(1).max(500),
  })
  .strict();

export const interviewEvaluationResultSchema = z
  .object({
    dimensions: z
      .object({
        relevance: interviewDimensionSchema,
        clarity: interviewDimensionSchema,
        completeness: interviewDimensionSchema,
        delivery: interviewDimensionSchema,
      })
      .strict(),
    overallFeedback: z.string().trim().min(1).max(1_000),
    improvementTips: z.array(z.string().trim().min(1).max(300)).min(1).max(5),
  })
  .strict();

export type CreateInterviewSessionInput = z.infer<
  typeof createInterviewSessionSchema
>;
export type InterviewAnswerInput = z.infer<typeof interviewAnswerInputSchema>;
export type InterviewSessionListQuery = z.infer<
  typeof interviewSessionListQuerySchema
>;
export type InterviewQuestionsResult = z.infer<
  typeof interviewQuestionsResultSchema
>;
export type InterviewEvaluationResult = z.infer<
  typeof interviewEvaluationResultSchema
>;
