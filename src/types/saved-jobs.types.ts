import type { JobStatus } from "./jobs.types.js";

export interface SavedJobRecord {
  jobId: string;
  savedAt: string | null;
  job: {
    id: string;
    title: string;
    employmentType: string | null;
    location: string | null;
    status: JobStatus;
    deadline: string | null;
    companyName: string;
  };
}

export interface SavedJobPage {
  savedJobs: SavedJobRecord[];
  total: number;
}
