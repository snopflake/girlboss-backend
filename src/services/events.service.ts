import type {
  EventPage,
  EventsRepositoryContract,
} from "../repositories/events.repository.js";
import type { EventRecord } from "../types/events.types.js";
import type { EventListQuery } from "../validators/events.validator.js";
import { HttpError } from "../utils/httpError.js";

export interface EventsServiceContract {
  listPublicEvents(query: EventListQuery): Promise<EventPage>;
  getPublicEvent(id: string): Promise<EventRecord>;
}

export class EventsService implements EventsServiceContract {
  constructor(private readonly repository: EventsRepositoryContract) {}

  listPublicEvents(query: EventListQuery): Promise<EventPage> {
    return this.repository.findPublicEvents(query);
  }

  async getPublicEvent(id: string): Promise<EventRecord> {
    const event = await this.repository.findPublicEventById(id);
    if (!event) {
      throw new HttpError(404, "Event tidak ditemukan.");
    }
    return event;
  }
}
