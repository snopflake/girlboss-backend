import { Router } from "express";
import multer from "multer";
import { createCvController } from "../controllers/cv.controller.js";
import { authenticateMiddleware } from "../middlewares/authenticate.middleware.js";
import { authorizeRoles } from "../middlewares/authorize.middleware.js";
import type { AuthServiceContract } from "../services/auth.service.js";
import type { CvServiceContract } from "../services/cv.service.js";
import { HttpError } from "../utils/httpError.js";

function createFileUploadMiddleware(maxFileSizeBytes: number) {
  const parseFile = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxFileSizeBytes,
      files: 1,
      fields: 0,
      parts: 1,
    },
  }).single("file");

  return (request: Parameters<typeof parseFile>[0], response: Parameters<typeof parseFile>[1], next: Parameters<typeof parseFile>[2]) => {
    parseFile(request, response, (error: unknown) => {
      if (!error) {
        next();
        return;
      }
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        next(new HttpError(413, "Ukuran file CV melebihi batas."));
        return;
      }
      if (error instanceof multer.MulterError) {
        next(new HttpError(400, "Form upload CV tidak valid."));
        return;
      }
      next(error);
    });
  };
}

export function createCvRouter(
  authService: AuthServiceContract,
  cvService: CvServiceContract,
  maxFileSizeBytes: number,
) {
  const router = Router();
  const controller = createCvController(cvService);
  const authenticate = authenticateMiddleware(authService);
  const applicantOnly = [authenticate, authorizeRoles("APPLICANT")];

  router.get("/applicant/cvs", ...applicantOnly, controller.list);
  router.post(
    "/applicant/cvs",
    ...applicantOnly,
    createFileUploadMiddleware(maxFileSizeBytes),
    controller.upload,
  );
  router.get("/applicant/cvs/:id/download", ...applicantOnly, controller.download);
  router.get("/applicant/cvs/:id", ...applicantOnly, controller.get);
  router.delete("/applicant/cvs/:id", ...applicantOnly, controller.remove);

  return router;
}
