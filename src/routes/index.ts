import { Router } from "express";
import type { Environment } from "../config/env.js";
import type { AuthServiceContract } from "../services/auth.service.js";
import { createAuthRouter } from "./auth.routes.js";
import healthRouter from "./health.routes.js";
import { createRoleTestRouter } from "./role-test.routes.js";
import { createJobsRouter } from "./jobs.routes.js";
import type { JobsServiceContract } from "../services/jobs.service.js";
import { createProfileRouter } from "./profile.routes.js";
import type { ProfileServiceContract } from "../services/profile.service.js";

export function createApiRouter(
  environment: Environment["NODE_ENV"],
  authService: AuthServiceContract,
  jobsService: JobsServiceContract,
  profileService: ProfileServiceContract,
) {
  const apiRouter = Router();

  apiRouter.use("/health", healthRouter);
  apiRouter.use("/auth", createAuthRouter(authService));
  apiRouter.use(
    "/",
    createProfileRouter(authService, profileService),
  );
  apiRouter.use(
    "/",
    createJobsRouter(authService, jobsService),
  );

  if (environment === "development") {
    apiRouter.use("/", createRoleTestRouter(authService));
  }

  return apiRouter;
}
