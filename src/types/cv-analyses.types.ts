import type { CvAnalysisResult } from "../validators/cv-analyses.validator.js";

export const cvAnalysisStatuses = [
  "PROCESSING",
  "COMPLETED",
  "FAILED",
] as const;

export type CvAnalysisStatus = (typeof cvAnalysisStatuses)[number];

export interface CvAnalysisRecord {
  id: string;
  cvId: string;
  status: CvAnalysisStatus;
  requestedAt: string;
  result: CvAnalysisResult | null;
}

export interface CvAnalysisPage {
  analyses: CvAnalysisRecord[];
  total: number;
}
