import type { CvAnalysisFile } from "../types/cv.types.js";
import type { CvTextExtractorContract } from "./cv-text-extractor.js";
import type {
  CvAnalysesRepositoryContract,
} from "../repositories/cv-analyses.repository.js";
import type {
  CvAnalysisPage,
  CvAnalysisRecord,
} from "../types/cv-analyses.types.js";
import type {
  CreateCvAnalysisInput,
  CvAnalysisListQuery,
} from "../validators/cv-analyses.validator.js";
import type { CvAnalyzerContract } from "./gemini-cv-analyzer.js";
import { HttpError } from "../utils/httpError.js";

export const MAX_CV_ANALYSES_PER_24_HOURS = 3;
const CV_ANALYSIS_WINDOW_MS = 24 * 60 * 60 * 1_000;
const MAX_ANALYSIS_TEXT_CHARS = 25_000;

export interface CvAnalysisCvServiceContract {
  getFileForAnalysis(userId: string, id: string): Promise<CvAnalysisFile>;
}

export interface CvAnalysesServiceContract {
  create(userId: string, input: CreateCvAnalysisInput): Promise<CvAnalysisRecord>;
  list(userId: string, query: CvAnalysisListQuery): Promise<CvAnalysisPage>;
  get(userId: string, id: string): Promise<CvAnalysisRecord>;
}

export class CvAnalysesService implements CvAnalysesServiceContract {
  constructor(
    private readonly repository: CvAnalysesRepositoryContract,
    private readonly cvService: CvAnalysisCvServiceContract,
    private readonly textExtractor: CvTextExtractorContract,
    private readonly analyzer: CvAnalyzerContract,
  ) {}

  async create(
    userId: string,
    input: CreateCvAnalysisInput,
  ): Promise<CvAnalysisRecord> {
    if (!this.analyzer.isConfigured()) {
      throw new HttpError(503, "AI CV Analyzer belum dikonfigurasi di backend.");
    }

    const applicantId = await this.getApplicantProfileId(userId);
    const since = new Date(Date.now() - CV_ANALYSIS_WINDOW_MS).toISOString();
    const analysisCount = await this.repository.countSince(applicantId, since);
    if (analysisCount >= MAX_CV_ANALYSES_PER_24_HOURS) {
      throw new HttpError(
        429,
        "Batas analisis CV 24 jam terakhir telah tercapai.",
      );
    }

    const source = await this.cvService.getFileForAnalysis(userId, input.cvId);
    if (source.applicantId !== applicantId) {
      throw new HttpError(404, "CV tidak ditemukan.");
    }

    const analysis = await this.repository.createProcessing(
      applicantId,
      source.metadata.id,
    );
    try {
      const extractedText = await this.textExtractor.extract(
        source.buffer,
        source.metadata.mimeType,
      );
      if (extractedText.trim().length < 20) {
        throw new HttpError(
          422,
          "Teks CV tidak dapat diekstrak atau terlalu sedikit untuk dianalisis.",
        );
      }

      const result = await this.analyzer.analyze(
        extractedText.slice(0, MAX_ANALYSIS_TEXT_CHARS),
      );
      return await this.repository.complete(
        analysis.id,
        applicantId,
        result,
      );
    } catch (error) {
      try {
        await this.repository.markFailed(analysis.id, applicantId);
      } catch {
        throw new HttpError(
          503,
          "Analisis CV gagal dan statusnya tidak dapat diperbarui.",
        );
      }
      throw error;
    }
  }

  async list(
    userId: string,
    query: CvAnalysisListQuery,
  ): Promise<CvAnalysisPage> {
    const applicantId = await this.getApplicantProfileId(userId);
    return this.repository.list(applicantId, query);
  }

  async get(userId: string, id: string): Promise<CvAnalysisRecord> {
    const applicantId = await this.getApplicantProfileId(userId);
    const analysis = await this.repository.findById(id, applicantId);
    if (!analysis) {
      throw new HttpError(404, "Analisis CV tidak ditemukan.");
    }
    return analysis;
  }

  private async getApplicantProfileId(userId: string): Promise<string> {
    const applicantId = await this.repository.findApplicantProfileId(userId);
    if (!applicantId) {
      throw new HttpError(404, "Profil applicant tidak ditemukan.");
    }
    return applicantId;
  }
}
