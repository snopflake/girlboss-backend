import { z } from "zod";
import { applicationStatuses } from "../types/applications.types.js";

export const applicationIdSchema = z.uuid();

export const applicationListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(applicationStatuses).optional(),
  })
  .strict();

export const createApplicationSchema = z
  .object({
    jobId: z.uuid(),
    cvId: z.uuid(),
    coverLetter: z.string().trim().max(10_000).nullable().optional(),
  })
  .strict();

export const updateApplicationStatusSchema = z
  .object({
    status: z.enum(applicationStatuses),
  })
  .strict();

export type ApplicationListQuery = z.infer<typeof applicationListQuerySchema>;
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
