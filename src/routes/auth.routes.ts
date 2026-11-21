import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { createAuthController } from "../controllers/auth.controller.js";
import { authenticateMiddleware } from "../middlewares/authenticate.middleware.js";
import type { AuthServiceContract } from "../services/auth.service.js";

function createAuthRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, response) => {
      response.status(429).json({
        success: false,
        message: "Terlalu banyak percobaan. Silakan coba kembali nanti.",
        errors: null,
      });
    },
  });
}

export function createAuthRouter(authService: AuthServiceContract) {
  const router = Router();
  const controller = createAuthController(authService);
  const authenticate = authenticateMiddleware(authService);

  router.post("/register", createAuthRateLimiter(), controller.register);
  router.post("/login", createAuthRateLimiter(), controller.login);
  router.get("/me", authenticate, controller.me);

  return router;
}
