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
import { SupabaseCvRepository } from "./repositories/cv.repository.js";
import {
  CvService,
  DEFAULT_CV_MAX_FILE_SIZE_BYTES,
  DEFAULT_CV_MAX_PER_APPLICANT,
} from "./services/cv.service.js";
import type { CvServiceContract } from "./services/cv.service.js";
import { SupabaseApplicationsRepository } from "./repositories/applications.repository.js";
import {
  ApplicationsService,
} from "./services/applications.service.js";
import type { ApplicationsServiceContract } from "./services/applications.service.js";
import { SupabaseSavedJobsRepository } from "./repositories/saved-jobs.repository.js";
import { SavedJobsService } from "./services/saved-jobs.service.js";
import type { SavedJobsServiceContract } from "./services/saved-jobs.service.js";

type AppConfig = Pick<Environment, "CORS_ORIGIN"> &
  Partial<
    Pick<
      Environment,
      "NODE_ENV" | "CV_MAX_FILE_SIZE_BYTES" | "CV_MAX_PER_APPLICANT"
    >
  >;

export function createApp(
  config: AppConfig,
  authService: AuthServiceContract = new AuthService(new SupabaseAuthRepository()),
  jobsService: JobsServiceContract = new JobsService(new SupabaseJobsRepository()),
  profileService: ProfileServiceContract = new ProfileService(
    new SupabaseProfileRepository(),
  ),
  cvService?: CvServiceContract,
  applicationsService?: ApplicationsServiceContract,
  savedJobsService?: SavedJobsServiceContract,
) {
  const app = express();
  const maxFileSizeBytes =
    config.CV_MAX_FILE_SIZE_BYTES ?? DEFAULT_CV_MAX_FILE_SIZE_BYTES;
  const maxPerApplicant =
    config.CV_MAX_PER_APPLICANT ?? DEFAULT_CV_MAX_PER_APPLICANT;
  const resolvedCvService =
    cvService ??
    new CvService(new SupabaseCvRepository(), {
      maxFileSizeBytes,
      maxPerApplicant,
    });
  const resolvedApplicationsService =
    applicationsService ??
    new ApplicationsService(new SupabaseApplicationsRepository());
  const resolvedSavedJobsService =
    savedJobsService ??
    new SavedJobsService(new SupabaseSavedJobsRepository());

  app.use(cors({ origin: config.CORS_ORIGIN }));
  app.use(express.json({ limit: "1mb" }));
  app.use(
    "/api",
    createApiRouter(
      config.NODE_ENV ?? "test",
      authService,
      jobsService,
      profileService,
      resolvedCvService,
      maxFileSizeBytes,
      resolvedApplicationsService,
      resolvedSavedJobsService,
    ),
  );
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
