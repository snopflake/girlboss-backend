import type { RequestHandler } from "express";
import type { InterviewSessionsServiceContract } from "../services/interview-sessions.service.js";
import { HttpError } from "../utils/httpError.js";
import {
  createInterviewSessionSchema,
  interviewAudioAnswerInputSchema,
  interviewAnswerInputSchema,
  interviewSessionIdSchema,
  interviewSessionListQuerySchema,
} from "../validators/interview-sessions.validator.js";

function validationIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}) {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

export function createInterviewSessionsController(
  service: InterviewSessionsServiceContract,
) {
  const create: RequestHandler = async (request, response, next) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }

    const parsed = createInterviewSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        message: "Input sesi wawancara tidak valid.",
        errors: validationIssues(parsed.error),
      });
      return;
    }

    try {
      const session = await service.create(user.id, parsed.data);
      response.status(201).json({
        success: true,
        message: "Sesi wawancara berhasil dibuat.",
        data: session,
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

    const parsed = interviewSessionListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        message: "Parameter riwayat wawancara tidak valid.",
        errors: validationIssues(parsed.error),
      });
      return;
    }

    try {
      const result = await service.list(user.id, parsed.data);
      response.status(200).json({
        success: true,
        message: "Riwayat wawancara berhasil diambil.",
        data: {
          sessions: result.sessions,
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

    const parsedId = interviewSessionIdSchema.safeParse(request.params.id);
    if (!parsedId.success) {
      response.status(400).json({
        success: false,
        message: "ID sesi wawancara tidak valid.",
        errors: validationIssues(parsedId.error),
      });
      return;
    }

    try {
      const session = await service.get(user.id, parsedId.data);
      response.status(200).json({
        success: true,
        message: "Detail sesi wawancara berhasil diambil.",
        data: session,
      });
    } catch (error) {
      next(error);
    }
  };

  const submitAnswer: RequestHandler = async (request, response, next) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }

    const parsedId = interviewSessionIdSchema.safeParse(request.params.id);
    if (!parsedId.success) {
      response.status(400).json({
        success: false,
        message: "ID sesi wawancara tidak valid.",
        errors: validationIssues(parsedId.error),
      });
      return;
    }

    const parsed = interviewAnswerInputSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        message: "Jawaban wawancara tidak valid.",
        errors: validationIssues(parsed.error),
      });
      return;
    }

    try {
      const answer = await service.submitAnswer(
        user.id,
        parsedId.data,
        parsed.data,
      );
      response.status(200).json({
        success: true,
        message: "Jawaban berhasil dievaluasi.",
        data: { answer },
      });
    } catch (error) {
      next(error);
    }
  };

  const complete: RequestHandler = async (request, response, next) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }

    const parsedId = interviewSessionIdSchema.safeParse(request.params.id);
    if (!parsedId.success) {
      response.status(400).json({
        success: false,
        message: "ID sesi wawancara tidak valid.",
        errors: validationIssues(parsedId.error),
      });
      return;
    }

    try {
      const session = await service.complete(user.id, parsedId.data);
      response.status(200).json({
        success: true,
        message: "Sesi wawancara berhasil diselesaikan.",
        data: { session, summary: session.summary },
      });
    } catch (error) {
      next(error);
    }
  };

  const submitAudioAnswer: RequestHandler = async (request, response, next) => {
    const user = request.authContext?.user;
    if (!user) {
      next(new HttpError(401, "Autentikasi diperlukan."));
      return;
    }

    const parsedId = interviewSessionIdSchema.safeParse(request.params.id);
    if (!parsedId.success) {
      response.status(400).json({
        success: false,
        message: "ID sesi wawancara tidak valid.",
        errors: validationIssues(parsedId.error),
      });
      return;
    }
    const parsed = interviewAudioAnswerInputSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        message: "Data jawaban audio tidak valid.",
        errors: validationIssues(parsed.error),
      });
      return;
    }
    if (!request.file) {
      response.status(400).json({
        success: false,
        message: "File audio wajib disertakan pada field audio.",
        errors: null,
      });
      return;
    }

    try {
      const answer = await service.submitAudioAnswer(
        user.id,
        parsedId.data,
        parsed.data,
        {
          buffer: request.file.buffer,
          mimeType: request.file.mimetype,
          originalName: request.file.originalname,
        },
      );
      response.status(200).json({
        success: true,
        message: "Rekaman berhasil ditranskripsikan dan dievaluasi.",
        data: { answer },
      });
    } catch (error) {
      next(error);
    }
  };

  return {
    create,
    list,
    get,
    submitAnswer,
    submitAudioAnswer,
    complete,
  };
}
