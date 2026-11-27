import { Router } from "express";
import { createCvAnalysesController } from "../controllers/cv-analyses.controller.js";
import { authenticateMiddleware } from "../middlewares/authenticate.middleware.js";
import { authorizeRoles } from "../middlewares/authorize.middleware.js";
import type { AuthServiceContract } from "../services/auth.service.js";
import type { CvAnalysesServiceContract } from "../services/cv-analyses.service.js";

export function createCvAnalysesRouter(
  authService: AuthServiceContract,
  service: CvAnalysesServiceContract,
) {
  const router = Router();
  const controller = createCvAnalysesController(service);
  const applicantOnly = [
    authenticateMiddleware(authService),
    authorizeRoles("APPLICANT"),
  ];

  router.post("/cv-analyses", ...applicantOnly, controller.create);
  router.get("/cv-analyses", ...applicantOnly, controller.list);
  router.get("/cv-analyses/:id", ...applicantOnly, controller.get);

  return router;
}
