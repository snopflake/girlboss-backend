import { z } from "zod";
import { jobStatuses } from "../types/jobs.types.js";

export const jobIdSchema = z.uuid();

export const jobListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().min(1).max(100).optional(),
    employmentType: z.string().trim().min(1).max(100).optional(),
    location: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

const jobFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    employmentType: z.string().trim().min(1).max(100).nullable(),
    location: z.string().trim().min(1).max(300).nullable(),
    deadline: z.iso.date().nullable(),
  })
  .strict();

export const createJobSchema = jobFieldsSchema
  .partial()
  .extend({
    title: jobFieldsSchema.shape.title,
  })
  .strict();

export const updateJobSchema = jobFieldsSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Berikan setidaknya satu field untuk diperbarui.",
  });

export const updateJobStatusSchema = z
  .object({
    status: z.enum(jobStatuses),
  })
  .strict();

export type JobListQuery = z.infer<typeof jobListQuerySchema>;
export type CreateJobInput = z.infer<typeof createJobSchema>;
export type UpdateJobInput = z.infer<typeof updateJobSchema>;
export type UpdateJobStatusInput = z.infer<typeof updateJobStatusSchema>;
