export const publicEventStatus = "PUBLISHED" as const;

export interface EventRecord {
  id: string;
  title: string;
  category: string | null;
  eventType: string | null;
  startDateTime: string;
  status: typeof publicEventStatus;
}
