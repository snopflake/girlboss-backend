import { Router } from "express";
import { createApplicationsController } from "../controllers/applications.controller.js";
import { authenticateMiddleware } from "../middlewares/authenticate.middleware.js";
import { authorizeRoles } from "../middlewares/authorize.middleware.js";
import type { AuthServiceContract } from "../services/auth.service.js";
import type { ApplicationsServiceContract } from "../services/applications.service.js";

export function createApplicationsRouter(
  authService: AuthServiceContract,
  applicationsService: ApplicationsServiceContract,
) {
  const router = Router();
  const controller = createApplicationsController(applicationsService);
  const authenticate = authenticateMiddleware(authService);
  const applicantOnly = [authenticate, authorizeRoles("APPLICANT")];
  const companyOnly = [authenticate, authorizeRoles("COMPANY")];

  router.post("/applications", ...applicantOnly, controller.submit);
  router.get("/applications", ...applicantOnly, controller.listApplicant);
  router.get("/applications/:id", ...applicantOnly, controller.getApplicant);
  router.get("/company/applications", ...companyOnly, controller.listCompany);
  router.get(
    "/company/applications/:id",
    ...companyOnly,
    controller.getCompany,
  );
  router.patch(
    "/company/applications/:id/status",
    ...companyOnly,
    controller.updateCompanyStatus,
  );

  return router;
}
