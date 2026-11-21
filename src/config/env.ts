import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

const optionalValue = (schema: z.ZodType<string>) =>
  z.preprocess((value: unknown) => (value === "" ? undefined : value), schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CORS_ORIGIN: z.string().url().default("http://localhost:5173"),
  SUPABASE_PROJECT_ID: optionalValue(z.string().min(1)),
  SUPABASE_URL: optionalValue(z.string().url()),
  SUPABASE_PUBLISHABLE_KEY: optionalValue(z.string().startsWith("sb_publishable_")),
  SUPABASE_SECRET_KEY: optionalValue(z.string().startsWith("sb_secret_")),
});

export type Environment = z.infer<typeof envSchema>;

export function loadEnv(): Environment {
  loadDotEnv();

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const invalidVariables = [
      ...new Set(
        result.error.issues
          .map((issue) => issue.path[0])
          .filter((name): name is string => typeof name === "string"),
      ),
    ];
    throw new Error(
      `Konfigurasi environment tidak valid untuk: ${invalidVariables.join(", ")}`,
    );
  }

  return result.data;
}
