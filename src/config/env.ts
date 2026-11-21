import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

const optionalValue = (schema: z.ZodType<string>) =>
  z.preprocess((value: unknown) => (value === "" ? undefined : value), schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CORS_ORIGIN: z.string().url().default("http://localhost:5173"),
  SUPABASE_URL: optionalValue(z.string().url()),
  SUPABASE_PUBLISHABLE_KEY: optionalValue(z.string().min(1)),
  SUPABASE_SECRET_KEY: optionalValue(z.string().min(1)),
});

export type Environment = z.infer<typeof envSchema>;

export function loadEnv(): Environment {
  loadDotEnv();

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const details = z.prettifyError(result.error);
    throw new Error(`Konfigurasi environment tidak valid:\n${details}`);
  }

  return result.data;
}
