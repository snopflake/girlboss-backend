import { z } from "zod";

const applicantRegistrationSchema = z
  .object({
    fullName: z.string().trim().min(1),
    email: z.email(),
    password: z.string().min(8),
    accountType: z.literal("APPLICANT"),
  })
  .strict();

const companyRegistrationSchema = z
  .object({
    fullName: z.string().trim().min(1),
    email: z.email(),
    password: z.string().min(8),
    accountType: z.literal("COMPANY"),
    companyName: z.string().trim().min(1),
  })
  .strict();

export const registerSchema = z.discriminatedUnion("accountType", [
  applicantRegistrationSchema,
  companyRegistrationSchema,
]);

export const loginSchema = z
  .object({
    email: z.email(),
    password: z.string().min(1),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
