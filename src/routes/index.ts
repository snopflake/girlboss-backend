import { Router } from "express";
import type { Environment } from "../config/env.js";
import type { AuthServiceContract } from "../services/auth.service.js";
import { createAuthRouter } from "./auth.routes.js";
import healthRouter from "./health.routes.js";
import { createRoleTestRouter } from "./role-test.routes.js";

export function createApiRouter(
  environment: Environment["NODE_ENV"],
  authService: AuthServiceContract,
) {
  const apiRouter = Router();

  apiRouter.use("/health", healthRouter);
  apiRouter.use("/auth", createAuthRouter(authService));

  if (environment === "development") {
    apiRouter.use("/", createRoleTestRouter(authService));
  }

  return apiRouter;
}
