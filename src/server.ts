import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";

try {
  const env = loadEnv();
  const app = createApp({ CORS_ORIGIN: env.CORS_ORIGIN });
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
