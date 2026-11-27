import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { z } from "zod";
import { createApp } from "../src/app.js";
import type {
  EventPage,
  EventsRepositoryContract,
} from "../src/repositories/events.repository.js";
import { publicEventStatus } from "../src/types/events.types.js";
import type { EventRecord } from "../src/types/events.types.js";
import { EventsService } from "../src/services/events.service.js";
import type { EventListQuery } from "../src/validators/events.validator.js";

const eventAId = "30000000-0000-4000-8000-000000000001";
const eventBId = "30000000-0000-4000-8000-000000000002";
const privateEventId = "30000000-0000-4000-8000-000000000003";

type StoredEvent = Omit<EventRecord, "status"> & { status: string };

const events: StoredEvent[] = [
  {
    id: eventAId,
    title: "Career Workshop",
    category: "category-a",
    eventType: "type-a",
    startDateTime: "2027-01-15T10:00:00Z",
    status: publicEventStatus,
  },
  {
    id: eventBId,
    title: "Community Meetup",
    category: "category-b",
    eventType: "type-b",
    startDateTime: "2027-02-20T10:00:00Z",
    status: publicEventStatus,
  },
  {
    id: privateEventId,
    title: "Unpublished Event",
    category: "category-a",
    eventType: "type-a",
    startDateTime: "2027-03-10T10:00:00Z",
    status: "DRAFT",
  },
];

function createMemoryRepository(): EventsRepositoryContract {
  function toPublicEvent(event: StoredEvent): EventRecord | null {
    if (event.status !== publicEventStatus) {
      return null;
    }
    return { ...event, status: publicEventStatus };
  }

  async function findPublicEvents(query: EventListQuery): Promise<EventPage> {
    const publishedEvents = events.filter((event) => {
      if (event.status !== publicEventStatus) {
        return false;
      }
      return (
        (!query.category || event.category === query.category) &&
        (!query.eventType || event.eventType === query.eventType) &&
        (!query.search ||
          event.title.toLowerCase().includes(query.search.toLowerCase()))
      );
    });
    const start = (query.page - 1) * query.pageSize;
    return {
      events: publishedEvents
        .slice(start, start + query.pageSize)
        .map((event) => {
          const publicEvent = toPublicEvent(event);
          assert.ok(publicEvent);
          return publicEvent;
        }),
      total: publishedEvents.length,
    };
  }

  return {
    findPublicEvents,
    async findPublicEventById(id) {
      const event = events.find((item) => item.id === id);
      return event ? toPublicEvent(event) : null;
    },
  };
}

async function withEventsServer(
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer(
    createApp(
      { CORS_ORIGIN: "http://localhost:5173", NODE_ENV: "test" },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new EventsService(createMemoryRepository()),
    ),
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

const eventResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string().nullable(),
  eventType: z.string().nullable(),
  startDateTime: z.string(),
  status: z.literal("PUBLISHED"),
});

test("public event list only exposes PUBLISHED events without authentication", async () => {
  await withEventsServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/events`);
    const body = z
      .object({
        success: z.literal(true),
        data: z.object({
          events: z.array(eventResponseSchema),
          pagination: z.object({
            page: z.number(),
            pageSize: z.number(),
            total: z.number(),
            totalPages: z.number(),
          }),
        }),
      })
      .parse(await response.json());

    assert.equal(response.status, 200);
    assert.equal(body.data.events.length, 2);
    assert.ok(body.data.events.every((event) => event.status === "PUBLISHED"));
    assert.equal(body.data.pagination.total, 2);
    assert.equal(
      body.data.events.some((event) => event.id === privateEventId),
      false,
    );
  });
});

test("event list filters by category, type, title, and pagination", async () => {
  await withEventsServer(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/events?category=category-a&eventType=type-a&search=career&page=1&pageSize=1`,
    );
    const body = z
      .object({
        success: z.literal(true),
        data: z.object({
          events: z.array(eventResponseSchema),
          pagination: z.object({
            page: z.number(),
            pageSize: z.number(),
            total: z.number(),
            totalPages: z.number(),
          }),
        }),
      })
      .parse(await response.json());

    assert.equal(response.status, 200);
    assert.equal(body.data.events.length, 1);
    assert.equal(body.data.events[0]?.id, eventAId);
    assert.equal(body.data.pagination.page, 1);
    assert.equal(body.data.pagination.total, 1);
  });
});

test("event details hide unpublished records and return 404 for missing events", async () => {
  await withEventsServer(async (baseUrl) => {
    const published = await fetch(`${baseUrl}/api/events/${eventAId}`);
    const publishedBody = z
      .object({ success: z.literal(true), data: eventResponseSchema })
      .parse(await published.json());
    const unpublished = await fetch(`${baseUrl}/api/events/${privateEventId}`);
    const missing = await fetch(
      `${baseUrl}/api/events/30000000-0000-4000-8000-000000000004`,
    );

    assert.equal(published.status, 200);
    assert.equal(publishedBody.data.id, eventAId);
    assert.equal(unpublished.status, 404);
    assert.equal(missing.status, 404);
  });
});

test("event endpoints reject malformed filters and identifiers", async () => {
  await withEventsServer(async (baseUrl) => {
    const invalidQuery = await fetch(`${baseUrl}/api/events?category=%20`);
    const invalidId = await fetch(`${baseUrl}/api/events/not-a-uuid`);

    assert.equal(invalidQuery.status, 400);
    assert.equal(invalidId.status, 400);
  });
});
