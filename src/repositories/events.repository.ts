import { getSupabaseAdminClient } from "../config/supabaseAdmin.js";
import { HttpError } from "../utils/httpError.js";
import type { EventRecord } from "../types/events.types.js";
import { publicEventStatus } from "../types/events.types.js";
import type { EventListQuery } from "../validators/events.validator.js";

export interface EventPage {
  events: EventRecord[];
  total: number;
}

export interface EventsRepositoryContract {
  findPublicEvents(query: EventListQuery): Promise<EventPage>;
  findPublicEventById(id: string): Promise<EventRecord | null>;
}

const eventColumns = "id, title, category, event_type, start_date_time, status";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toEventRecord(value: unknown): EventRecord {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    (value.category !== null && typeof value.category !== "string") ||
    (value.event_type !== null && typeof value.event_type !== "string") ||
    typeof value.start_date_time !== "string" ||
    value.status !== publicEventStatus
  ) {
    throw new HttpError(503, "Data event tidak valid.");
  }

  return {
    id: value.id,
    title: value.title,
    category: value.category,
    eventType: value.event_type,
    startDateTime: value.start_date_time,
    status: publicEventStatus,
  };
}

function throwDatabaseError(): never {
  throw new HttpError(503, "Data event tidak dapat diproses.");
}

async function executeDatabaseRequest<T>(
  createRequest: () => PromiseLike<T>,
): Promise<T> {
  try {
    return await createRequest();
  } catch {
    throwDatabaseError();
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export class SupabaseEventsRepository implements EventsRepositoryContract {
  async findPublicEvents(query: EventListQuery): Promise<EventPage> {
    const { data, error, count } = await executeDatabaseRequest(() => {
      let request = getSupabaseAdminClient()
        .from("events")
        .select(eventColumns, { count: "exact" })
        .eq("status", publicEventStatus);

      if (query.category) {
        request = request.eq("category", query.category);
      }
      if (query.eventType) {
        request = request.eq("event_type", query.eventType);
      }
      if (query.search) {
        request = request.ilike("title", `%${escapeLikePattern(query.search)}%`);
      }

      return request
        .order("start_date_time", { ascending: true })
        .order("id", { ascending: true })
        .range(
          (query.page - 1) * query.pageSize,
          query.page * query.pageSize - 1,
        );
    });

    if (error || !Array.isArray(data) || count === null) {
      throwDatabaseError();
    }

    return { events: data.map(toEventRecord), total: count };
  }

  async findPublicEventById(id: string): Promise<EventRecord | null> {
    const { data, error } = await executeDatabaseRequest(() =>
      getSupabaseAdminClient()
        .from("events")
        .select(eventColumns)
        .eq("id", id)
        .eq("status", publicEventStatus)
        .maybeSingle(),
    );

    if (error) {
      throwDatabaseError();
    }
    return data ? toEventRecord(data) : null;
  }
}
