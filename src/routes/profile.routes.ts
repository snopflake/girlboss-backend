import { Router } from "express";
import { createProfileController } from "../controllers/profile.controller.js";
import { authenticateMiddleware } from "../middlewares/authenticate.middleware.js";
import { authorizeRoles } from "../middlewares/authorize.middleware.js";
import type { AuthServiceContract } from "../services/auth.service.js";
import type { ProfileServiceContract } from "../services/profile.service.js";

export function createProfileRouter(
  authService: AuthServiceContract,
  profileService: ProfileServiceContract,
) {
  const router = Router();
  const controller = createProfileController(profileService);
  const authenticate = authenticateMiddleware(authService);

  router
    .route("/applicant/profile")
    .get(authenticate, authorizeRoles("APPLICANT"), controller.getApplicantProfile)
    .patch(
      authenticate,
      authorizeRoles("APPLICANT"),
      controller.updateApplicantProfile,
    );

  router
    .route("/company/profile")
    .get(authenticate, authorizeRoles("COMPANY"), controller.getCompanyProfile)
    .patch(
      authenticate,
      authorizeRoles("COMPANY"),
      controller.updateCompanyProfile,
    );

  return router;
}
