export const applicationStatuses = [
  "TERKIRIM",
  "DITINJAU",
  "WAWANCARA",
  "DITERIMA",
  "DITOLAK",
] as const;

export type ApplicationStatus = (typeof applicationStatuses)[number];

export interface ApplicationDocumentMetadata {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

export interface ApplicationApplicantSummary {
  fullName: string;
  headline: string | null;
}

export interface ApplicationRecord {
  id: string;
  applicantId: string;
  jobId: string;
  coverLetter: string | null;
  status: ApplicationStatus;
  submittedAt: string;
  job: {
    id: string;
    title: string;
    employmentType: string | null;
    location: string | null;
    deadline: string | null;
    companyName: string;
  };
  documents: ApplicationDocumentMetadata[];
  applicant: ApplicationApplicantSummary | null;
}

export interface SubmittedApplication {
  id: string;
  applicantId: string;
  jobId: string;
  coverLetter: string | null;
  status: ApplicationStatus;
  submittedAt: string;
  documentId: string;
}

export interface ApplicationPage {
  applications: ApplicationRecord[];
  total: number;
}
