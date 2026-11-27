import type { RequestHandler } from "express";
import type { SavedJobRecord } from "../types/saved-jobs.types.js";
import type { SavedJobsServiceContract } from "../services/saved-jobs.service.js";
import {
  saveJobSchema,
  savedJobIdSchema,
  savedJobListQuerySchema,
} from "../validators/saved-jobs.validator.js";
import { HttpError } from "../utils/httpError.js";

function validationIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}) {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

function toSavedJobResponse(savedJob: SavedJobRecord) {
  return {
    savedAt: savedJob.savedAt,
    job: {
      id: savedJob.job.id,
      title: savedJob.job.title,
      employmentType: savedJob.job.employmentType,
      location: savedJob.job.location,
      status: savedJob.job.status,
      deadline: savedJob.job.deadline,
      companyName: savedJob.job.companyName,
    },
  };
}

export function createSavedJobsController(service: SavedJobsServiceContract) {
  const list: RequestHandler = async (request, response, next) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }
    const parsed = savedJobListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        message: "Parameter daftar lowongan tersimpan tidak valid.",
        errors: validationIssues(parsed.error),
      });
      return;
    }

    try {
      const result = await service.list(user.id, parsed.data);
      response.status(200).json({
        success: true,
        message: "Daftar lowongan tersimpan berhasil diambil.",
        data: {
          savedJobs: result.savedJobs.map(toSavedJobResponse),
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

  const save: RequestHandler = async (request, response, next) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }
    const parsed = saveJobSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        message: "Input lowongan tersimpan tidak valid.",
        errors: validationIssues(parsed.error),
      });
      return;
    }

    try {
      const result = await service.save(user.id, parsed.data);
      response.status(201).json({
        success: true,
        message: "Lowongan berhasil disimpan.",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  const remove: RequestHandler = async (request, response, next) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }
    const parsedJobId = savedJobIdSchema.safeParse(request.params.jobId);
    if (!parsedJobId.success) {
      response.status(400).json({
        success: false,
        message: "ID lowongan tidak valid.",
        errors: validationIssues(parsedJobId.error),
      });
      return;
    }

    try {
      await service.remove(user.id, parsedJobId.data);
      response.status(200).json({
        success: true,
        message: "Lowongan tersimpan berhasil dihapus.",
        data: { jobId: parsedJobId.data },
      });
    } catch (error) {
      next(error);
    }
  };

  return { list, save, remove };
}
