import type { RequestHandler } from "express";
import type { CvAnalysesServiceContract } from "../services/cv-analyses.service.js";
import { HttpError } from "../utils/httpError.js";
import {
  createCvAnalysisSchema,
  cvAnalysisIdSchema,
  cvAnalysisListQuerySchema,
} from "../validators/cv-analyses.validator.js";

function validationIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}) {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

function toResponse(analysis: {
  id: string;
  cvId: string;
  status: string;
  requestedAt: string;
  result: unknown;
}) {
  return {
    id: analysis.id,
    cvId: analysis.cvId,
    status: analysis.status,
    requestedAt: analysis.requestedAt,
    result: analysis.result,
  };
}

export function createCvAnalysesController(
  service: CvAnalysesServiceContract,
) {
  const create: RequestHandler = async (request, response, next) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }

    const parsed = createCvAnalysisSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        message: "Input analisis CV tidak valid.",
        errors: validationIssues(parsed.error),
      });
      return;
    }

    try {
      const analysis = await service.create(user.id, parsed.data);
      response.status(201).json({
        success: true,
        message: "Analisis CV berhasil diselesaikan.",
        data: toResponse(analysis),
      });
    } catch (error) {
      next(error);
    }
  };

  const list: RequestHandler = async (request, response, next) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }

    const parsed = cvAnalysisListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        message: "Parameter riwayat analisis CV tidak valid.",
        errors: validationIssues(parsed.error),
      });
      return;
    }

    try {
      const result = await service.list(user.id, parsed.data);
      response.status(200).json({
        success: true,
        message: "Riwayat analisis CV berhasil diambil.",
        data: {
          analyses: result.analyses.map(toResponse),
          pagination: {
            page: parsed.data.page,
            pageSize: parsed.data.pageSize,
            total: result.total,
            totalPages: Math.ceil(result.total / parsed.data.pageSize),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  };

  const get: RequestHandler = async (request, response, next) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }

    const parsedId = cvAnalysisIdSchema.safeParse(request.params.id);
    if (!parsedId.success) {
      response.status(400).json({
        success: false,
        message: "ID analisis CV tidak valid.",
        errors: validationIssues(parsedId.error),
      });
      return;
    }

    try {
      const analysis = await service.get(user.id, parsedId.data);
      response.status(200).json({
        success: true,
        message: "Detail analisis CV berhasil diambil.",
        data: toResponse(analysis),
      });
    } catch (error) {
      next(error);
    }
  };

  return { create, list, get };
}
