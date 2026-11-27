import { Router } from "express";
import { createEventsController } from "../controllers/events.controller.js";
import type { EventsServiceContract } from "../services/events.service.js";

export function createEventsRouter(service: EventsServiceContract) {
  const router = Router();
  const controller = createEventsController(service);

  router.get("/events", controller.listPublicEvents);
  router.get("/events/:id", controller.getPublicEvent);

  return router;
}
