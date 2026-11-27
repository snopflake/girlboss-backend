import { getSupabaseAdminClient } from "../config/supabaseAdmin.js";
import type {
  CvAnalysisPage,
  CvAnalysisRecord,
} from "../types/cv-analyses.types.js";
import { cvAnalysisStatuses } from "../types/cv-analyses.types.js";
import type {
  CvAnalysisResult,
  CvAnalysisListQuery,
} from "../validators/cv-analyses.validator.js";
import { cvAnalysisSummarySchema } from "../validators/cv-analyses.validator.js";
import { HttpError } from "../utils/httpError.js";

export interface CvAnalysesRepositoryContract {
  findApplicantProfileId(userId: string): Promise<string | null>;
  countSince(applicantId: string, since: string): Promise<number>;
  createProcessing(applicantId: string, cvId: string): Promise<CvAnalysisRecord>;
  complete(
    id: string,
    applicantId: string,
    result: CvAnalysisResult,
  ): Promise<CvAnalysisRecord>;
  markFailed(id: string, applicantId: string): Promise<void>;
  list(
    applicantId: string,
    query: CvAnalysisListQuery,
  ): Promise<CvAnalysisPage>;
  findById(id: string, applicantId: string): Promise<CvAnalysisRecord | null>;
}

const analysisColumns =
  "id, applicant_id, document_id, status, summary, recommendations, requested_at";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toCvAnalysisRecord(value: unknown): CvAnalysisRecord {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.document_id !== "string" ||
    !cvAnalysisStatuses.includes(
      value.status as (typeof cvAnalysisStatuses)[number],
    ) ||
    (value.summary !== null && typeof value.summary !== "string") ||
    !Array.isArray(value.recommendations) ||
    !value.recommendations.every((item) => typeof item === "string") ||
    typeof value.requested_at !== "string"
  ) {
    throw new HttpError(503, "Data analisis CV tidak valid.");
  }

  const status = value.status as CvAnalysisRecord["status"];
  let result: CvAnalysisResult | null = null;
  if (status === "COMPLETED") {
    if (typeof value.summary !== "string") {
      throw new HttpError(503, "Hasil analisis CV tidak valid.");
    }

    let storedSummary: unknown;
    try {
      storedSummary = JSON.parse(value.summary);
    } catch {
      throw new HttpError(503, "Hasil analisis CV tidak valid.");
    }
    const parsedSummary = cvAnalysisSummarySchema.safeParse(storedSummary);
    if (!parsedSummary.success) {
      throw new HttpError(503, "Hasil analisis CV tidak valid.");
    }
    result = {
      ...parsedSummary.data,
      recommendations: value.recommendations,
    };
  }

  return {
    id: value.id,
    cvId: value.document_id,
    status,
    requestedAt: value.requested_at,
    result,
  };
}

function throwDatabaseError(): never {
  throw new HttpError(503, "Data analisis CV tidak dapat diproses.");
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

function storedSummary(result: CvAnalysisResult): string {
  return JSON.stringify({
    score: result.score,
    summary: result.summary,
    strengths: result.strengths,
    weaknesses: result.weaknesses,
  });
}

export class SupabaseCvAnalysesRepository
  implements CvAnalysesRepositoryContract
{
  async findApplicantProfileId(userId: string): Promise<string | null> {
    const { data, error } = await executeDatabaseRequest(() =>
      getSupabaseAdminClient()
        .from("applicant_profiles")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle(),
    );
    if (
      error ||
      (data !== null &&
        (!isRecord(data) || typeof data.id !== "string"))
    ) {
      throwDatabaseError();
    }
    return data ? data.id : null;
  }

  async countSince(applicantId: string, since: string): Promise<number> {
    const { count, error } = await executeDatabaseRequest(() =>
      getSupabaseAdminClient()
        .from("cv_analyses")
        .select("id", { count: "exact", head: true })
        .eq("applicant_id", applicantId)
        .gte("requested_at", since),
    );
    if (error || count === null) {
      throwDatabaseError();
    }
    return count;
  }

  async createProcessing(
    applicantId: string,
    cvId: string,
  ): Promise<CvAnalysisRecord> {
    const { data, error } = await executeDatabaseRequest(() =>
      getSupabaseAdminClient()
        .from("cv_analyses")
        .insert({
          applicant_id: applicantId,
          document_id: cvId,
          status: "PROCESSING",
          recommendations: [],
        })
        .select(analysisColumns)
        .single(),
    );
    if (error || !data) {
      throwDatabaseError();
    }
    return toCvAnalysisRecord(data);
  }

  async complete(
    id: string,
    applicantId: string,
    result: CvAnalysisResult,
  ): Promise<CvAnalysisRecord> {
    const { data, error } = await executeDatabaseRequest(() =>
      getSupabaseAdminClient()
        .from("cv_analyses")
        .update({
          status: "COMPLETED",
          summary: storedSummary(result),
          recommendations: result.recommendations,
        })
        .eq("id", id)
        .eq("applicant_id", applicantId)
        .select(analysisColumns)
        .maybeSingle(),
    );
    if (error || !data) {
      throwDatabaseError();
    }
    return toCvAnalysisRecord(data);
  }

  async markFailed(id: string, applicantId: string): Promise<void> {
    const { data, error } = await executeDatabaseRequest(() =>
      getSupabaseAdminClient()
        .from("cv_analyses")
        .update({ status: "FAILED", recommendations: [] })
        .eq("id", id)
        .eq("applicant_id", applicantId)
        .select("id")
        .maybeSingle(),
    );
    if (error || !data) {
      throwDatabaseError();
    }
  }

  async list(
    applicantId: string,
    query: CvAnalysisListQuery,
  ): Promise<CvAnalysisPage> {
    const { data, error, count } = await executeDatabaseRequest(() =>
      getSupabaseAdminClient()
        .from("cv_analyses")
        .select(analysisColumns, { count: "exact" })
        .eq("applicant_id", applicantId)
        .order("requested_at", { ascending: false })
        .order("id", { ascending: false })
        .range(
          (query.page - 1) * query.pageSize,
          query.page * query.pageSize - 1,
        ),
    );
    if (error || !Array.isArray(data) || count === null) {
      throwDatabaseError();
    }
    return { analyses: data.map(toCvAnalysisRecord), total: count };
  }

  async findById(
    id: string,
    applicantId: string,
  ): Promise<CvAnalysisRecord | null> {
    const { data, error } = await executeDatabaseRequest(() =>
      getSupabaseAdminClient()
        .from("cv_analyses")
        .select(analysisColumns)
        .eq("id", id)
        .eq("applicant_id", applicantId)
        .maybeSingle(),
    );
    if (error) {
      throwDatabaseError();
    }
    return data ? toCvAnalysisRecord(data) : null;
  }
}
