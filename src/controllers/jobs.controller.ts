import type { RequestHandler } from "express";
import type { JobsServiceContract } from "../services/jobs.service.js";
import {
  createJobSchema,
  jobIdSchema,
  jobListQuerySchema,
  updateJobSchema,
  updateJobStatusSchema,
} from "../validators/jobs.validator.js";
import { HttpError } from "../utils/httpError.js";

function validationIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}) {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

function toJobResponse(job: Awaited<ReturnType<JobsServiceContract["getPublicJob"]>>) {
  return {
    id: job.id,
    title: job.title,
    employmentType: job.employmentType,
    location: job.location,
    status: job.status,
    deadline: job.deadline,
  };
}

function pageData(
  jobs: Awaited<ReturnType<JobsServiceContract["listPublicJobs"]>>,
  page: number,
  pageSize: number,
) {
  return {
    jobs: jobs.jobs.map(toJobResponse),
    pagination: {
      page,
      pageSize,
      total: jobs.total,
      totalPages: Math.ceil(jobs.total / pageSize),
    },
  };
}

export function createJobsController(service: JobsServiceContract) {
  const listPublicJobs: RequestHandler = async (request, response, next) => {
    const parsed = jobListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        message: "Parameter pencarian lowongan tidak valid.",
        errors: validationIssues(parsed.error),
      });
      return;
    }

    try {
      const result = await service.listPublicJobs(parsed.data);
      response.status(200).json({
        success: true,
        message: "Daftar lowongan berhasil diambil.",
        data: pageData(result, parsed.data.page, parsed.data.pageSize),
      });
    } catch (error) {
      next(error);
    }
  };

  const getPublicJob: RequestHandler = async (request, response, next) => {
    const parsedId = jobIdSchema.safeParse(request.params.id);
    if (!parsedId.success) {
      response.status(400).json({
        success: false,
        message: "ID lowongan tidak valid.",
        errors: validationIssues(parsedId.error),
      });
      return;
    }

    try {
      const job = await service.getPublicJob(parsedId.data);
      response.status(200).json({
        success: true,
        message: "Detail lowongan berhasil diambil.",
        data: toJobResponse(job),
      });
    } catch (error) {
      next(error);
    }
  };

  const createCompanyJob: RequestHandler = async (request, response, next) => {
    const authContext = request.authContext;
    if (!authContext) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }
    const parsed = createJobSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        message: "Input lowongan tidak valid.",
        errors: validationIssues(parsed.error),
      });
      return;
    }

    try {
      const job = await service.createCompanyJob(authContext.user.id, parsed.data);
      response.status(201).json({
        success: true,
        message: "Lowongan draft berhasil dibuat.",
        data: toJobResponse(job),
      });
    } catch (error) {
      next(error);
    }
  };

  const listCompanyJobs: RequestHandler = async (request, response, next) => {
    const authContext = request.authContext;
    if (!authContext) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }
    const parsed = jobListQuerySchema
      .pick({ page: true, pageSize: true })
      .safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        message: "Parameter pagination tidak valid.",
        errors: validationIssues(parsed.error),
      });
      return;
    }

    try {
      const result = await service.listCompanyJobs(
        authContext.user.id,
        parsed.data.page,
        parsed.data.pageSize,
      );
      response.status(200).json({
        success: true,
        message: "Daftar lowongan perusahaan berhasil diambil.",
        data: pageData(result, parsed.data.page, parsed.data.pageSize),
      });
    } catch (error) {
      next(error);
    }
  };

  const updateCompanyJob: RequestHandler = async (request, response, next) => {
    const authContext = request.authContext;
    if (!authContext) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }
    const parsedId = jobIdSchema.safeParse(request.params.id);
    const parsedBody = updateJobSchema.safeParse(request.body);
    if (!parsedId.success || !parsedBody.success) {
      const issues = [
        ...(parsedId.success ? [] : validationIssues(parsedId.error)),
        ...(parsedBody.success ? [] : validationIssues(parsedBody.error)),
      ];
      response.status(400).json({
        success: false,
        message: "Input pembaruan lowongan tidak valid.",
        errors: issues,
      });
      return;
    }

    try {
      const job = await service.updateCompanyJob(
        authContext.user.id,
        parsedId.data,
        parsedBody.data,
      );
      response.status(200).json({
        success: true,
        message: "Lowongan berhasil diperbarui.",
        data: toJobResponse(job),
      });
    } catch (error) {
      next(error);
    }
  };

  const updateCompanyJobStatus: RequestHandler = async (
    request,
    response,
    next,
  ) => {
    const authContext = request.authContext;
    if (!authContext) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }
    const parsedId = jobIdSchema.safeParse(request.params.id);
    const parsedBody = updateJobStatusSchema.safeParse(request.body);
    if (!parsedId.success || !parsedBody.success) {
      const issues = [
        ...(parsedId.success ? [] : validationIssues(parsedId.error)),
        ...(parsedBody.success ? [] : validationIssues(parsedBody.error)),
      ];
      response.status(400).json({
        success: false,
        message: "Input status lowongan tidak valid.",
        errors: issues,
      });
      return;
    }

    try {
      const job = await service.updateCompanyJobStatus(
        authContext.user.id,
        parsedId.data,
        parsedBody.data.status,
      );
      response.status(200).json({
        success: true,
        message: "Status lowongan berhasil diperbarui.",
        data: toJobResponse(job),
      });
    } catch (error) {
      next(error);
    }
  };

  return {
    listPublicJobs,
    getPublicJob,
    createCompanyJob,
    listCompanyJobs,
    updateCompanyJob,
    updateCompanyJobStatus,
  };
}
