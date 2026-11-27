import { z } from "zod";

const nullableText = z.string().trim().min(1).nullable();

export const updateApplicantProfileSchema = z
  .object({
    headline: nullableText.optional(),
    phoneNumber: nullableText.optional(),
    professionalSummary: nullableText.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Berikan setidaknya satu field untuk diperbarui.",
  });

export const updateCompanyProfileSchema = z
  .object({
    companyName: z.string().trim().min(1).optional(),
    industry: nullableText.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Berikan setidaknya satu field untuk diperbarui.",
  });

export type UpdateApplicantProfileInput = z.infer<
  typeof updateApplicantProfileSchema
>;
export type UpdateCompanyProfileInput = z.infer<
  typeof updateCompanyProfileSchema
>;
