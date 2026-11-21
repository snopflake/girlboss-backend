import type { RequestHandler } from "express";
import type { ApplicationRole } from "../types/auth.types.js";
import { HttpError } from "../utils/httpError.js";

export function authorizeRoles(
  ...allowedRoles: ApplicationRole[]
): RequestHandler {
  return (request, _response, next) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }

    if (!allowedRoles.includes(user.role)) {
      next(new HttpError(403, "Anda tidak memiliki izin untuk mengakses resource ini."));
      return;
    }

    next();
  };
}
