import { z } from "zod";

export const eventIdSchema = z.uuid();

export const eventListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    category: z.string().trim().min(1).max(100).optional(),
    eventType: z.string().trim().min(1).max(100).optional(),
    search: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export type EventListQuery = z.infer<typeof eventListQuerySchema>;
