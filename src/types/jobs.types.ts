export const jobStatuses = ["DRAFT", "ACTIVE", "CLOSED"] as const;

export type JobStatus = (typeof jobStatuses)[number];

export interface JobRecord {
  id: string;
  companyId: string;
  title: string;
  employmentType: string | null;
  location: string | null;
  status: JobStatus;
  deadline: string | null;
}

export interface JobResponse {
  id: string;
  title: string;
  employmentType: string | null;
  location: string | null;
  status: JobStatus;
  deadline: string | null;
}

export interface CompanyJobProfile {
  id: string;
  verificationStatus: string;
}
