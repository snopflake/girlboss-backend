import { z } from "zod";

export const cvAnalysisIdSchema = z.uuid();

export const createCvAnalysisSchema = z
  .object({
    cvId: z.uuid(),
  })
  .strict();

export const cvAnalysisListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const analysisItemSchema = z.string().trim().min(1).max(500);

export const cvAnalysisSummarySchema = z
  .object({
    score: z.number().int().min(0).max(100),
    summary: z.string().trim().min(1).max(1200),
    strengths: z.array(analysisItemSchema).min(1).max(8),
    weaknesses: z.array(analysisItemSchema).min(1).max(8),
  })
  .strict();

export const cvAnalysisResultSchema = cvAnalysisSummarySchema
  .extend({
    recommendations: z.array(analysisItemSchema).min(1).max(8),
  })
  .strict();

export type CreateCvAnalysisInput = z.infer<typeof createCvAnalysisSchema>;
export type CvAnalysisListQuery = z.infer<typeof cvAnalysisListQuerySchema>;
export type CvAnalysisResult = z.infer<typeof cvAnalysisResultSchema>;
