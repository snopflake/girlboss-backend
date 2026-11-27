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
import { createCvRouter } from "./cv.routes.js";
import type { CvServiceContract } from "../services/cv.service.js";
import { createApplicationsRouter } from "./applications.routes.js";
import type { ApplicationsServiceContract } from "../services/applications.service.js";
import { createSavedJobsRouter } from "./saved-jobs.routes.js";
import type { SavedJobsServiceContract } from "../services/saved-jobs.service.js";
import { createEventsRouter } from "./events.routes.js";
import type { EventsServiceContract } from "../services/events.service.js";
import { createCvAnalysesRouter } from "./cv-analyses.routes.js";
import type { CvAnalysesServiceContract } from "../services/cv-analyses.service.js";
import { createInterviewSessionsRouter } from "./interview-sessions.routes.js";
import type { InterviewSessionsServiceContract } from "../services/interview-sessions.service.js";

export function createApiRouter(
  environment: Environment["NODE_ENV"],
  authService: AuthServiceContract,
  jobsService: JobsServiceContract,
  profileService: ProfileServiceContract,
  cvService: CvServiceContract,
  cvMaxFileSizeBytes: number,
  applicationsService: ApplicationsServiceContract,
  savedJobsService: SavedJobsServiceContract,
  eventsService: EventsServiceContract,
  cvAnalysesService: CvAnalysesServiceContract,
  interviewSessionsService: InterviewSessionsServiceContract,
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
    createCvRouter(authService, cvService, cvMaxFileSizeBytes),
  );
  apiRouter.use(
    "/",
    createJobsRouter(authService, jobsService),
  );
  apiRouter.use(
    "/",
    createApplicationsRouter(authService, applicationsService),
  );
  apiRouter.use(
    "/",
    createSavedJobsRouter(authService, savedJobsService),
  );
  apiRouter.use("/", createEventsRouter(eventsService));
  apiRouter.use("/", createCvAnalysesRouter(authService, cvAnalysesService));
  apiRouter.use(
    "/",
    createInterviewSessionsRouter(authService, interviewSessionsService),
  );

  if (environment === "development") {
    apiRouter.use("/", createRoleTestRouter(authService));
  }

  return apiRouter;
}
