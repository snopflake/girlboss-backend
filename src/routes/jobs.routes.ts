import { Router } from "express";
import { createJobsController } from "../controllers/jobs.controller.js";
import { authenticateMiddleware } from "../middlewares/authenticate.middleware.js";
import { authorizeRoles } from "../middlewares/authorize.middleware.js";
import type { AuthServiceContract } from "../services/auth.service.js";
import type { JobsServiceContract } from "../services/jobs.service.js";

export function createJobsRouter(
  authService: AuthServiceContract,
  jobsService: JobsServiceContract,
) {
  const router = Router();
  const controller = createJobsController(jobsService);
  const authenticate = authenticateMiddleware(authService);
  const companyOnly = [authenticate, authorizeRoles("COMPANY")];

  router.get("/jobs", controller.listPublicJobs);
  router.get("/jobs/:id", controller.getPublicJob);
  router.post("/company/jobs", ...companyOnly, controller.createCompanyJob);
  router.get("/company/jobs", ...companyOnly, controller.listCompanyJobs);
  router.patch(
    "/company/jobs/:id/status",
    ...companyOnly,
    controller.updateCompanyJobStatus,
  );
  router.patch("/company/jobs/:id", ...companyOnly, controller.updateCompanyJob);

  return router;
}
