import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";

try {
  const env = loadEnv();
  const app = createApp({
    CORS_ORIGIN: env.CORS_ORIGIN,
    NODE_ENV: env.NODE_ENV,
    CV_MAX_FILE_SIZE_BYTES: env.CV_MAX_FILE_SIZE_BYTES,
    CV_MAX_PER_APPLICANT: env.CV_MAX_PER_APPLICANT,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    GEMINI_MODEL: env.GEMINI_MODEL,
    GROQ_API_KEY: env.GROQ_API_KEY,
    GROQ_WHISPER_MODEL: env.GROQ_WHISPER_MODEL,
  });
  const server = app.listen(env.PORT, () => {
    console.info(`GirlBoss API berjalan pada port ${env.PORT}`);
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error("Gagal menjalankan server:", error.message);
    process.exitCode = 1;
  });
} catch (error) {
  console.error("Startup server gagal:", error);
  process.exitCode = 1;
}
