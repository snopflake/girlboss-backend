import type { RequestHandler } from "express";
import type { CvServiceContract } from "../services/cv.service.js";
import { cvIdSchema } from "../validators/cv.validator.js";
import { HttpError } from "../utils/httpError.js";

function validationIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}) {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

function getUserId(request: Parameters<RequestHandler>[0]): string | null {
  return request.authContext?.user.id ?? null;
}

export function createCvController(service: CvServiceContract) {
  const list: RequestHandler = async (request, response, next) => {
    const userId = getUserId(request);
    if (!userId) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }

    try {
      const cvs = await service.list(userId);
      response.status(200).json({
        success: true,
        message: "Daftar CV berhasil diambil.",
        data: { cvs },
      });
    } catch (error) {
      next(error);
    }
  };

  const upload: RequestHandler = async (request, response, next) => {
    const userId = getUserId(request);
    if (!userId) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }
    if (!request.file) {
      response.status(400).json({
        success: false,
        message: "File CV wajib diunggah pada field `file`.",
        errors: null,
      });
      return;
    }

    try {
      const cv = await service.upload(userId, {
        originalName: request.file.originalname,
        mimeType: request.file.mimetype,
        buffer: request.file.buffer,
      });
      response.status(201).json({
        success: true,
        message: "CV berhasil diunggah.",
        data: cv,
      });
    } catch (error) {
      next(error);
    }
  };

  const get: RequestHandler = async (request, response, next) => {
    const userId = getUserId(request);
    if (!userId) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }
    const parsedId = cvIdSchema.safeParse(request.params.id);
    if (!parsedId.success) {
      response.status(400).json({
        success: false,
        message: "ID CV tidak valid.",
        errors: validationIssues(parsedId.error),
      });
      return;
    }

    try {
      const cv = await service.get(userId, parsedId.data);
      response.status(200).json({
        success: true,
        message: "Metadata CV berhasil diambil.",
        data: cv,
      });
    } catch (error) {
      next(error);
    }
  };

  const download: RequestHandler = async (request, response, next) => {
    const userId = getUserId(request);
    if (!userId) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }
    const parsedId = cvIdSchema.safeParse(request.params.id);
    if (!parsedId.success) {
      response.status(400).json({
        success: false,
        message: "ID CV tidak valid.",
        errors: validationIssues(parsedId.error),
      });
      return;
    }

    try {
      const download = await service.createDownloadUrl(userId, parsedId.data);
      response.status(200).json({
        success: true,
        message: "Link unduhan sementara berhasil dibuat.",
        data: download,
      });
    } catch (error) {
      next(error);
    }
  };

  const remove: RequestHandler = async (request, response, next) => {
    const userId = getUserId(request);
    if (!userId) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }
    const parsedId = cvIdSchema.safeParse(request.params.id);
    if (!parsedId.success) {
      response.status(400).json({
        success: false,
        message: "ID CV tidak valid.",
        errors: validationIssues(parsedId.error),
      });
      return;
    }

    try {
      await service.delete(userId, parsedId.data);
      response.status(200).json({
        success: true,
        message: "CV berhasil dihapus.",
        data: { id: parsedId.data },
      });
    } catch (error) {
      next(error);
    }
  };

  return { list, upload, get, download, remove };
}
