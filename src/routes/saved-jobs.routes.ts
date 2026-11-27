import { Router } from "express";
import { createSavedJobsController } from "../controllers/saved-jobs.controller.js";
import { authenticateMiddleware } from "../middlewares/authenticate.middleware.js";
import { authorizeRoles } from "../middlewares/authorize.middleware.js";
import type { AuthServiceContract } from "../services/auth.service.js";
import type { SavedJobsServiceContract } from "../services/saved-jobs.service.js";

export function createSavedJobsRouter(
  authService: AuthServiceContract,
  savedJobsService: SavedJobsServiceContract,
) {
  const router = Router();
  const controller = createSavedJobsController(savedJobsService);
  const applicantOnly = [
    authenticateMiddleware(authService),
    authorizeRoles("APPLICANT"),
  ];

  router.get("/applicant/saved-jobs", ...applicantOnly, controller.list);
  router.post("/applicant/saved-jobs", ...applicantOnly, controller.save);
  router.delete(
    "/applicant/saved-jobs/:jobId",
    ...applicantOnly,
    controller.remove,
  );

  return router;
}
