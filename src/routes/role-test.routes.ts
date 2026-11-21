import { Router } from "express";
import { authenticateMiddleware } from "../middlewares/authenticate.middleware.js";
import { authorizeRoles } from "../middlewares/authorize.middleware.js";
import type { AuthServiceContract } from "../services/auth.service.js";

export function createRoleTestRouter(authService: AuthServiceContract) {
  const router = Router();
  const authenticate = authenticateMiddleware(authService);

  router.get(
    "/applicant/test",
    authenticate,
    authorizeRoles("APPLICANT"),
    (_request, response) => {
      response.json({ success: true, message: "Akses APPLICANT berhasil.", data: null });
    },
  );
  router.get(
    "/company/test",
    authenticate,
    authorizeRoles("COMPANY"),
    (_request, response) => {
      response.json({ success: true, message: "Akses COMPANY berhasil.", data: null });
    },
  );
  router.get(
    "/admin/test",
    authenticate,
    authorizeRoles("ADMIN"),
    (_request, response) => {
      response.json({ success: true, message: "Akses ADMIN berhasil.", data: null });
    },
  );

  return router;
}
