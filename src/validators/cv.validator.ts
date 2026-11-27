import { z } from "zod";

export const cvIdSchema = z.uuid();

export const cvUploadMetadataSchema = z
  .object({
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine(
        (value) =>
          ![...value].some((character) => {
            const code = character.codePointAt(0) ?? 0;
            return code < 32 || code === 127;
          }),
      ),
    mimeType: z.enum([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
    fileSize: z.number().int().positive(),
  })
  .strict();
