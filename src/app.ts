import cors from "cors";
import express from "express";
import type { Environment } from "./config/env.js";
import { errorMiddleware } from "./middlewares/error.middleware.js";
import { notFoundMiddleware } from "./middlewares/notFound.middleware.js";
import { createApiRouter } from "./routes/index.js";
import { AuthService } from "./services/auth.service.js";
import { SupabaseAuthRepository } from "./repositories/auth.repository.js";
import type { AuthServiceContract } from "./services/auth.service.js";
import { SupabaseJobsRepository } from "./repositories/jobs.repository.js";
import { JobsService } from "./services/jobs.service.js";
import type { JobsServiceContract } from "./services/jobs.service.js";
import { SupabaseProfileRepository } from "./repositories/profile.repository.js";
import { ProfileService } from "./services/profile.service.js";
import type { ProfileServiceContract } from "./services/profile.service.js";

type AppConfig = Pick<Environment, "CORS_ORIGIN"> &
  Partial<Pick<Environment, "NODE_ENV">>;

export function createApp(
  config: AppConfig,
  authService: AuthServiceContract = new AuthService(new SupabaseAuthRepository()),
  jobsService: JobsServiceContract = new JobsService(new SupabaseJobsRepository()),
  profileService: ProfileServiceContract = new ProfileService(
    new SupabaseProfileRepository(),
  ),
) {
  const app = express();

  app.use(cors({ origin: config.CORS_ORIGIN }));
  app.use(express.json({ limit: "1mb" }));
  app.use(
    "/api",
    createApiRouter(
      config.NODE_ENV ?? "test",
      authService,
      jobsService,
      profileService,
    ),
  );
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
