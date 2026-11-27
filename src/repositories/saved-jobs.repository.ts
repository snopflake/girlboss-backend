import { getSupabaseAdminClient } from "../config/supabaseAdmin.js";
import type { JobStatus } from "../types/jobs.types.js";
import type { SavedJobPage, SavedJobRecord } from "../types/saved-jobs.types.js";
import type {
  SaveJobInput,
  SavedJobListQuery,
} from "../validators/saved-jobs.validator.js";
import { HttpError } from "../utils/httpError.js";

export interface CreateSavedJobInput extends SaveJobInput {
  applicantId: string;
}

export interface SavedJobsRepositoryContract {
  findApplicantProfileId(userId: string): Promise<string | null>;
  findJobStatus(jobId: string): Promise<JobStatus | null>;
  createSavedJob(input: CreateSavedJobInput): Promise<void>;
  listSavedJobs(
    applicantId: string,
    query: SavedJobListQuery,
  ): Promise<SavedJobPage>;
  deleteSavedJob(applicantId: string, jobId: string): Promise<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function throwDatabaseError(message: string): never {
  throw new HttpError(503, message);
}

async function executeDatabaseRequest<T>(
  createRequest: () => PromiseLike<T>,
  errorMessage: string,
): Promise<T> {
  try {
    return await createRequest();
  } catch {
    throwDatabaseError(errorMessage);
  }
}

function databaseErrorText(error: Record<string, unknown>): string {
  return [error.constraint, error.details, error.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

export function toSavedJobDatabaseHttpError(error: unknown): HttpError {
  if (isRecord(error) && typeof error.code === "string") {
    const diagnostics = databaseErrorText(error);
    if (
      error.code === "23505" &&
      diagnostics.includes("saved_jobs_unique")
    ) {
      return new HttpError(409, "Lowongan sudah ada di daftar tersimpan.");
    }
    if (
      error.code === "23503" &&
      /(saved_jobs_job_id_fkey|saved_jobs_applicant_id_fkey)/.test(diagnostics)
    ) {
      return new HttpError(404, "Lowongan atau profil applicant tidak ditemukan.");
    }
  }
  return new HttpError(503, "Data lowongan tersimpan tidak dapat diproses.");
}

function toJobStatus(value: unknown): JobStatus {
  if (value === "ACTIVE" || value === "CLOSED" || value === "DRAFT") {
    return value;
  }
  throwDatabaseError("Status lowongan tersimpan tidak valid.");
}

function toSavedJobRecord(value: unknown): SavedJobRecord {
  if (
    !isRecord(value) ||
    typeof value.job_id !== "string" ||
    (value.saved_at !== null && typeof value.saved_at !== "string")
  ) {
    throwDatabaseError("Data lowongan tersimpan tidak valid.");
  }

  const job = isRecord(value.job)
    ? value.job
    : Array.isArray(value.job) && isRecord(value.job[0])
      ? value.job[0]
      : null;
  if (!job) {
    throwDatabaseError("Data lowongan tersimpan tidak valid.");
  }
  const company = isRecord(job.company)
    ? job.company
    : Array.isArray(job.company) && isRecord(job.company[0])
      ? job.company[0]
      : null;
  if (
    !company ||
    typeof job.id !== "string" ||
    typeof job.title !== "string" ||
    typeof company.company_name !== "string" ||
    (job.employment_type !== null &&
      typeof job.employment_type !== "string") ||
    (job.location !== null && typeof job.location !== "string") ||
    (job.deadline !== null && typeof job.deadline !== "string")
  ) {
    throwDatabaseError("Data lowongan tersimpan tidak valid.");
  }

  return {
    jobId: value.job_id,
    savedAt: value.saved_at,
    job: {
      id: job.id,
      title: job.title,
      employmentType: job.employment_type,
      location: job.location,
      status: toJobStatus(job.status),
      deadline: job.deadline,
      companyName: company.company_name,
    },
  };
}

export class SupabaseSavedJobsRepository
  implements SavedJobsRepositoryContract
{
  async findApplicantProfileId(userId: string): Promise<string | null> {
    const { data, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("applicant_profiles")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle(),
      "Profil applicant tidak dapat diperiksa.",
    );
    if (error || (data !== null && (!isRecord(data) || typeof data.id !== "string"))) {
      throwDatabaseError("Profil applicant tidak dapat diperiksa.");
    }
    return data ? data.id : null;
  }

  async findJobStatus(jobId: string): Promise<JobStatus | null> {
    const { data, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("jobs")
          .select("status")
          .eq("id", jobId)
          .maybeSingle(),
      "Status lowongan tidak dapat diperiksa.",
    );
    if (error) {
      throwDatabaseError("Status lowongan tidak dapat diperiksa.");
    }
    return data ? toJobStatus(data.status) : null;
  }

  async createSavedJob(input: CreateSavedJobInput): Promise<void> {
    const { error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("saved_jobs")
          .insert({
            applicant_id: input.applicantId,
            job_id: input.jobId,
          }),
      "Lowongan tidak dapat disimpan.",
    );
    if (error) {
      throw toSavedJobDatabaseHttpError(error);
    }
  }

  async listSavedJobs(
    applicantId: string,
    query: SavedJobListQuery,
  ): Promise<SavedJobPage> {
    const { data, error, count } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("saved_jobs")
          .select(
            `
              job_id, saved_at,
              job:jobs!saved_jobs_job_id_fkey(
                id, title, employment_type, location, status, deadline,
                company:companies!jobs_company_id_fkey(company_name)
              )
            `,
            { count: "exact" },
          )
          .eq("applicant_id", applicantId)
          .order("saved_at", { ascending: false })
          .order("job_id", { ascending: false })
          .range(
            (query.page - 1) * query.pageSize,
            query.page * query.pageSize - 1,
          ),
      "Daftar lowongan tersimpan tidak dapat diambil.",
    );
    if (error || !Array.isArray(data) || count === null) {
      throwDatabaseError("Daftar lowongan tersimpan tidak dapat diambil.");
    }
    return {
      savedJobs: data.map(toSavedJobRecord),
      total: count,
    };
  }

  async deleteSavedJob(applicantId: string, jobId: string): Promise<boolean> {
    const { data, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("saved_jobs")
          .delete()
          .eq("applicant_id", applicantId)
          .eq("job_id", jobId)
          .select("job_id")
          .maybeSingle(),
      "Lowongan tersimpan tidak dapat dihapus.",
    );
    if (error) {
      throwDatabaseError("Lowongan tersimpan tidak dapat dihapus.");
    }
    return data !== null;
  }
}
