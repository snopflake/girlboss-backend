import type { RequestHandler } from "express";
import type { AuthServiceContract } from "../services/auth.service.js";
import { loginSchema, registerSchema } from "../validators/auth.validator.js";
import { HttpError } from "../utils/httpError.js";

function validationIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

export function createAuthController(authService: AuthServiceContract) {
  const register: RequestHandler = async (request, response, next) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        message: "Input registrasi tidak valid.",
        errors: validationIssues(parsed.error),
      });
      return;
    }

    try {
      await authService.register(parsed.data);
      response.status(202).json({
        success: true,
        message: "Jika pendaftaran dapat diproses, periksa email untuk langkah selanjutnya.",
        data: null,
      });
    } catch (error) {
      next(error);
    }
  };

  const login: RequestHandler = async (request, response, next) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        message: "Input login tidak valid.",
        errors: validationIssues(parsed.error),
      });
      return;
    }

    try {
      const session = await authService.login(parsed.data);
      response.status(200).json({
        success: true,
        message: "Login berhasil.",
        data: {
          user: {
            id: session.user.id,
            email: session.user.email,
            fullName: session.user.fullName,
            role: session.user.role,
            accountStatus: session.user.accountStatus,
          },
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresIn: session.expiresIn,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  const me: RequestHandler = async (request, response, next) => {
    const authContext = request.authContext;
    if (!authContext) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }

    try {
      const currentUser = await authService.getCurrentUser(
        authContext.user,
        authContext.accessToken,
      );
      response.status(200).json({
        success: true,
        message: "Data pengguna berhasil diambil.",
        data: currentUser,
      });
    } catch (error) {
      next(error);
    }
  };

  return { register, login, me };
}
