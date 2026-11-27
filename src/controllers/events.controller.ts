import type { RequestHandler } from "express";
import type { EventsServiceContract } from "../services/events.service.js";
import {
  eventIdSchema,
  eventListQuerySchema,
} from "../validators/events.validator.js";

function validationIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}) {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

function toEventResponse(
  event: Awaited<ReturnType<EventsServiceContract["getPublicEvent"]>>,
) {
  return {
    id: event.id,
    title: event.title,
    category: event.category,
    eventType: event.eventType,
    startDateTime: event.startDateTime,
    status: event.status,
  };
}

export function createEventsController(service: EventsServiceContract) {
  const listPublicEvents: RequestHandler = async (request, response, next) => {
    const parsed = eventListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({
        success: false,
        message: "Parameter pencarian event tidak valid.",
        errors: validationIssues(parsed.error),
      });
      return;
    }

    try {
      const result = await service.listPublicEvents(parsed.data);
      response.status(200).json({
        success: true,
        message: "Daftar event berhasil diambil.",
        data: {
          events: result.events.map(toEventResponse),
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

  const getPublicEvent: RequestHandler = async (request, response, next) => {
    const parsedId = eventIdSchema.safeParse(request.params.id);
    if (!parsedId.success) {
      response.status(400).json({
        success: false,
        message: "ID event tidak valid.",
        errors: validationIssues(parsedId.error),
      });
      return;
    }

    try {
      const event = await service.getPublicEvent(parsedId.data);
      response.status(200).json({
        success: true,
        message: "Detail event berhasil diambil.",
        data: toEventResponse(event),
      });
    } catch (error) {
      next(error);
    }
  };

  return { listPublicEvents, getPublicEvent };
}
