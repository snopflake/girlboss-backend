import { Router } from "express";
import multer from "multer";
import { createInterviewSessionsController } from "../controllers/interview-sessions.controller.js";
import { authenticateMiddleware } from "../middlewares/authenticate.middleware.js";
import { authorizeRoles } from "../middlewares/authorize.middleware.js";
import type { AuthServiceContract } from "../services/auth.service.js";
import type { InterviewSessionsServiceContract } from "../services/interview-sessions.service.js";
import {
  MAX_INTERVIEW_AUDIO_BYTES,
} from "../services/interview-audio.js";
import { HttpError } from "../utils/httpError.js";

const allowedAudioMimeTypes = new Set([
  "audio/webm",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
]);

function createAudioUploadMiddleware() {
  const parseAudio = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_INTERVIEW_AUDIO_BYTES,
      files: 1,
      fields: 1,
      fieldSize: 128,
      parts: 2,
    },
    fileFilter: (_request, file, callback) => {
      const mimeType = file.mimetype.split(";")[0]?.trim().toLowerCase();
      if (!mimeType || !allowedAudioMimeTypes.has(mimeType)) {
        callback(new HttpError(400, "Format audio harus WebM, WAV, atau OGG."));
        return;
      }
      callback(null, true);
    },
  }).single("audio");

  return (request: Parameters<typeof parseAudio>[0], response: Parameters<typeof parseAudio>[1], next: Parameters<typeof parseAudio>[2]) => {
    parseAudio(request, response, (error: unknown) => {
      if (!error) {
        next();
        return;
      }
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        next(new HttpError(413, "Ukuran rekaman melebihi batas 20 MiB."));
        return;
      }
      if (error instanceof multer.MulterError) {
        next(new HttpError(400, "Form upload audio tidak valid."));
        return;
      }
      next(error);
    });
  };
}

export function createInterviewSessionsRouter(
  authService: AuthServiceContract,
  service: InterviewSessionsServiceContract,
) {
  const router = Router();
  const controller = createInterviewSessionsController(service);
  const applicantOnly = [
    authenticateMiddleware(authService),
    authorizeRoles("APPLICANT"),
  ];

  router.post("/interview-sessions", ...applicantOnly, controller.create);
  router.get("/interview-sessions", ...applicantOnly, controller.list);
  router.get("/interview-sessions/:id", ...applicantOnly, controller.get);
  router.post(
    "/interview-sessions/:id/answers",
    ...applicantOnly,
    controller.submitAnswer,
  );
  router.post(
    "/interview-sessions/:id/audio-answers",
    ...applicantOnly,
    createAudioUploadMiddleware(),
    controller.submitAudioAnswer,
  );
  router.post(
    "/interview-sessions/:id/complete",
    ...applicantOnly,
    controller.complete,
  );

  return router;
}
