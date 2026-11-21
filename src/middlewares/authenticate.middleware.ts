import type { RequestHandler } from "express";
import type { AuthServiceContract } from "../services/auth.service.js";
import { HttpError } from "../utils/httpError.js";

export function authenticateMiddleware(
  authService: AuthServiceContract,
): RequestHandler {
  return async (request, _response, next) => {
    const authorization = request.get("authorization");
    const match = authorization?.match(/^Bearer\s+(\S+)$/i);
    if (!match) {
      next(new HttpError(401, "Token autentikasi diperlukan."));
      return;
    }

    try {
      const user = await authService.authenticate(match[1]);
      request.authContext = {
        user,
        accessToken: match[1],
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}
