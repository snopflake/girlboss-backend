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

export const interviewAudioAnswerInputSchema = z
  .object({
    questionId: z.uuid(),
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

export const speechDeliveryMetricsSchema = z
  .object({
    durationSeconds: z.number().positive().nullable(),
    durationStatus: z.enum(["MEASURED", "UNAVAILABLE"]),
    wordCount: z.number().int().nonnegative().nullable(),
    wordsPerMinute: z.number().nonnegative().nullable(),
    speechRateStatus: z.enum([
      "MEASURED",
      "INSUFFICIENT_TRANSCRIPT",
      "UNAVAILABLE",
    ]),
    pauseCount: z.number().int().nonnegative().nullable(),
    totalPauseSeconds: z.number().nonnegative().nullable(),
    pauseStatus: z.enum([
      "ESTIMATED_FROM_SEGMENTS",
      "MEASURED",
      "INSUFFICIENT_SEGMENTS",
      "UNAVAILABLE",
    ]),
    pauseSource: z.literal("WHISPER_SEGMENT_TIMESTAMPS").optional(),
    pauseThresholdSeconds: z.number().positive().optional(),
    pitchMedianHz: z.number().positive().nullable().optional(),
    pitchVariation: z.number().nonnegative().nullable(),
    pitchVariationUnit: z.literal("semitones").optional(),
    voicedFrameCount: z.number().int().nonnegative().nullable().optional(),
    pitchStatus: z.enum([
      "MEASURED",
      "INSUFFICIENT_VOICED_FRAMES",
      "UNSUPPORTED_FORMAT",
      "NOT_ANALYZED",
    ]),
    pitchFeedback: z.string().trim().min(1).max(500).optional(),
    deliveryFeedback: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const storedInterviewEvaluationSchema = z.union([
  interviewEvaluationResultSchema,
  z
    .object({
      evaluation: interviewEvaluationResultSchema,
      speechMetrics: speechDeliveryMetricsSchema,
    })
    .strict(),
]);

export type CreateInterviewSessionInput = z.infer<
  typeof createInterviewSessionSchema
>;
export type InterviewAnswerInput = z.infer<typeof interviewAnswerInputSchema>;
export type InterviewAudioAnswerInput = z.infer<
  typeof interviewAudioAnswerInputSchema
>;
export type InterviewSessionListQuery = z.infer<
  typeof interviewSessionListQuerySchema
>;
export type InterviewQuestionsResult = z.infer<
  typeof interviewQuestionsResultSchema
>;
export type InterviewEvaluationResult = z.infer<
  typeof interviewEvaluationResultSchema
>;
export type SpeechDeliveryMetrics = z.infer<
  typeof speechDeliveryMetricsSchema
>;
