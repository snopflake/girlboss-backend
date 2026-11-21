import cors from "cors";
import express from "express";
import type { Environment } from "./config/env.js";
import { errorMiddleware } from "./middlewares/error.middleware.js";
import { notFoundMiddleware } from "./middlewares/notFound.middleware.js";
import apiRouter from "./routes/index.js";

type AppConfig = Pick<Environment, "CORS_ORIGIN">;

export function createApp(config: AppConfig) {
  const app = express();

  app.use(cors({ origin: config.CORS_ORIGIN }));
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", apiRouter);
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
