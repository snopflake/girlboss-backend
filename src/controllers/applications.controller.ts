import type { RequestHandler } from "express";
import type {
  ApplicationPage,
  ApplicationRecord,
  SubmittedApplication,
} from "../types/applications.types.js";
import type { ApplicationsServiceContract } from "../services/applications.service.js";
import {
  applicationIdSchema,
  applicationListQuerySchema,
  createApplicationSchema,
  updateApplicationStatusSchema,
} from "../validators/applications.validator.js";
import { HttpError } from "../utils/httpError.js";

function validationIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}) {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

function toApplicantResponse(application: ApplicationRecord) {
  return {
    id: application.id,
    status: application.status,
    submittedAt: application.submittedAt,
    coverLetter: application.coverLetter,
    job: {
      id: application.job.id,
      title: application.job.title,
      employmentType: application.job.employmentType,
      location: application.job.location,
      deadline: application.job.deadline,
      companyName: application.job.companyName,
    },
    cvDocuments: application.documents.map(({ id, fileSize, mimeType }) => ({
      id,
      fileSize,
      mimeType,
    })),
  };
}

function toCompanyResponse(application: ApplicationRecord) {
  return {
    id: application.id,
    status: application.status,
    submittedAt: application.submittedAt,
    coverLetter: application.coverLetter,
    job: {
      id: application.job.id,
      title: application.job.title,
    },
    applicant: application.applicant,
    cvDocuments: application.documents.map(({ id, fileSize, mimeType }) => ({
      id,
      fileSize,
      mimeType,
    })),
  };
}

function pageData<T>(
  result: ApplicationPage,
  page: number,
  pageSize: number,
  responseMapper: (application: ApplicationRecord) => T,
) {
  return {
    applications: result.applications.map(responseMapper),
    pagination: {
      page,
      pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / pageSize),
    },
  };
}

function toSubmittedResponse(application: SubmittedApplication) {
  return {
    id: application.id,
    jobId: application.jobId,
    cvId: application.documentId,
    coverLetter: application.coverLetter,
    status: application.status,
    submittedAt: application.submittedAt,
  };
}

export function createApplicationsController(
  service: ApplicationsServiceContract,
) {
  const submit: RequestHandler = async (request, response, next) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }
    const parsed = createApplicationSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        message: "Input lamaran tidak valid.",
        errors: validationIssues(parsed.error),
      });
      return;
    }

    try {
      const application = await service.submit(user.id, parsed.data);
      response.status(201).json({
        success: true,
        message: "Lamaran berhasil dikirim.",
        data: toSubmittedResponse(application),
      });
    } catch (error) {
      next(error);
    }
  };

  const listApplicant: RequestHandler = async (request, response, next) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }
    const parsed = applicationListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        message: "Parameter riwayat lamaran tidak valid.",
        errors: validationIssues(parsed.error),
      });
      return;
    }

    try {
      const result = await service.listApplicant(user.id, parsed.data);
      response.status(200).json({
        success: true,
        message: "Riwayat lamaran berhasil diambil.",
        data: pageData(
          result,
          parsed.data.page,
          parsed.data.pageSize,
          toApplicantResponse,
        ),
      });
    } catch (error) {
      next(error);
    }
  };

  const getApplicant: RequestHandler = async (request, response, next) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }
    const parsedId = applicationIdSchema.safeParse(request.params.id);
    if (!parsedId.success) {
      response.status(400).json({
        success: false,
        message: "ID lamaran tidak valid.",
        errors: validationIssues(parsedId.error),
      });
      return;
    }

    try {
      const application = await service.getApplicant(user.id, parsedId.data);
      response.status(200).json({
        success: true,
        message: "Detail lamaran berhasil diambil.",
        data: toApplicantResponse(application),
      });
    } catch (error) {
      next(error);
    }
  };

  const listCompany: RequestHandler = async (request, response, next) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }
    const parsed = applicationListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        message: "Parameter daftar lamaran tidak valid.",
        errors: validationIssues(parsed.error),
      });
      return;
    }

    try {
      const result = await service.listCompany(user.id, parsed.data);
      response.status(200).json({
        success: true,
        message: "Daftar lamaran perusahaan berhasil diambil.",
        data: pageData(
          result,
          parsed.data.page,
          parsed.data.pageSize,
          toCompanyResponse,
        ),
      });
    } catch (error) {
      next(error);
    }
  };

  const getCompany: RequestHandler = async (request, response, next) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }
    const parsedId = applicationIdSchema.safeParse(request.params.id);
    if (!parsedId.success) {
      response.status(400).json({
        success: false,
        message: "ID lamaran tidak valid.",
        errors: validationIssues(parsedId.error),
      });
      return;
    }

    try {
      const application = await service.getCompany(user.id, parsedId.data);
      response.status(200).json({
        success: true,
        message: "Detail lamaran berhasil diambil.",
        data: toCompanyResponse(application),
      });
    } catch (error) {
      next(error);
    }
  };

  const updateCompanyStatus: RequestHandler = async (
    request,
    response,
    next,
  ) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }
    const parsedId = applicationIdSchema.safeParse(request.params.id);
    const parsedBody = updateApplicationStatusSchema.safeParse(request.body);
    if (!parsedId.success || !parsedBody.success) {
      response.status(400).json({
        success: false,
        message: "Input pembaruan status lamaran tidak valid.",
        errors: [
          ...(parsedId.success ? [] : validationIssues(parsedId.error)),
          ...(parsedBody.success ? [] : validationIssues(parsedBody.error)),
        ],
      });
      return;
    }

    try {
      const application = await service.updateCompanyStatus(
        user.id,
        parsedId.data,
        parsedBody.data.status,
      );
      response.status(200).json({
        success: true,
        message: "Status lamaran berhasil diperbarui.",
        data: toCompanyResponse(application),
      });
    } catch (error) {
      next(error);
    }
  };

  return {
    submit,
    listApplicant,
    getApplicant,
    listCompany,
    getCompany,
    updateCompanyStatus,
  };
}
