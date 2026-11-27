import { z } from "zod";

export const savedJobIdSchema = z.uuid();

export const savedJobListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const saveJobSchema = z
  .object({
    jobId: z.uuid(),
  })
  .strict();

export type SavedJobListQuery = z.infer<typeof savedJobListQuerySchema>;
export type SaveJobInput = z.infer<typeof saveJobSchema>;
