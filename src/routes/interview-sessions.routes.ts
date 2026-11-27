import { Router } from "express";
import { createInterviewSessionsController } from "../controllers/interview-sessions.controller.js";
import { authenticateMiddleware } from "../middlewares/authenticate.middleware.js";
import { authorizeRoles } from "../middlewares/authorize.middleware.js";
import type { AuthServiceContract } from "../services/auth.service.js";
import type { InterviewSessionsServiceContract } from "../services/interview-sessions.service.js";

export function createInterviewSessionsRouter(
  authService: AuthServiceContract,
  service: InterviewSessionsServiceContract,
) {
  const router = Router();
  const controller = createInterviewSessionsController(service);
  const applicantOnly = [
    authenticateMiddleware(authService),
    authorizeRoles("APPLICANT"),
  ];

  router.post("/interview-sessions", ...applicantOnly, controller.create);
  router.get("/interview-sessions", ...applicantOnly, controller.list);
  router.get("/interview-sessions/:id", ...applicantOnly, controller.get);
  router.post(
    "/interview-sessions/:id/answers",
    ...applicantOnly,
    controller.submitAnswer,
  );
  router.post(
    "/interview-sessions/:id/complete",
    ...applicantOnly,
    controller.complete,
  );

  return router;
}
