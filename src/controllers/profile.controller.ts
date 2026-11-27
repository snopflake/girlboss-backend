import type { RequestHandler } from "express";
import type { ProfileServiceContract } from "../services/profile.service.js";
import {
  updateApplicantProfileSchema,
  updateCompanyProfileSchema,
} from "../validators/profile.validator.js";
import { HttpError } from "../utils/httpError.js";

function validationIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}) {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

export function createProfileController(service: ProfileServiceContract) {
  const getApplicantProfile: RequestHandler = async (
    request,
    response,
    next,
  ) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }

    try {
      const profile = await service.getApplicantProfile(user.id);
      response.status(200).json({
        success: true,
        message: "Profil applicant berhasil diambil.",
        data: { fullName: user.fullName, ...profile },
      });
    } catch (error) {
      next(error);
    }
  };

  const updateApplicantProfile: RequestHandler = async (
    request,
    response,
    next,
  ) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }

    const parsed = updateApplicantProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        message: "Input profil applicant tidak valid.",
        errors: validationIssues(parsed.error),
      });
      return;
    }

    try {
      const profile = await service.updateApplicantProfile(
        user.id,
        parsed.data,
      );
      response.status(200).json({
        success: true,
        message: "Profil applicant berhasil diperbarui.",
        data: { fullName: user.fullName, ...profile },
      });
    } catch (error) {
      next(error);
    }
  };

  const getCompanyProfile: RequestHandler = async (
    request,
    response,
    next,
  ) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }

    try {
      const profile = await service.getCompanyProfile(user.id);
      response.status(200).json({
        success: true,
        message: "Profil perusahaan berhasil diambil.",
        data: { fullName: user.fullName, ...profile },
      });
    } catch (error) {
      next(error);
    }
  };

  const updateCompanyProfile: RequestHandler = async (
    request,
    response,
    next,
  ) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }

    const parsed = updateCompanyProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        message: "Input profil perusahaan tidak valid.",
        errors: validationIssues(parsed.error),
      });
      return;
    }

    try {
      const profile = await service.updateCompanyProfile(
        user.id,
        parsed.data,
      );
      response.status(200).json({
        success: true,
        message: "Profil perusahaan berhasil diperbarui.",
        data: { fullName: user.fullName, ...profile },
      });
    } catch (error) {
      next(error);
    }
  };

  return {
    getApplicantProfile,
    updateApplicantProfile,
    getCompanyProfile,
    updateCompanyProfile,
  };
}
