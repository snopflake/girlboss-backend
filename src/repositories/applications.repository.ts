import { getSupabaseAdminClient } from "../config/supabaseAdmin.js";
import type {
  ApplicationDocumentMetadata,
  ApplicationPage,
  ApplicationRecord,
  ApplicationStatus,
  SubmittedApplication,
} from "../types/applications.types.js";
import type { ApplicationListQuery, CreateApplicationInput } from "../validators/applications.validator.js";
import { HttpError } from "../utils/httpError.js";

export interface SubmitApplicationRepositoryInput extends CreateApplicationInput {
  applicantId: string;
}

export interface ApplicationsRepositoryContract {
  findApplicantProfileId(userId: string): Promise<string | null>;
  findCompanyProfileId(userId: string): Promise<string | null>;
  submitApplication(
    input: SubmitApplicationRepositoryInput,
  ): Promise<SubmittedApplication>;
  listApplicantApplications(
    applicantId: string,
    query: ApplicationListQuery,
  ): Promise<ApplicationPage>;
  findApplicantApplication(
    id: string,
    applicantId: string,
  ): Promise<ApplicationRecord | null>;
  listCompanyApplications(
    companyId: string,
    query: ApplicationListQuery,
  ): Promise<ApplicationPage>;
  findCompanyApplication(
    id: string,
    companyId: string,
  ): Promise<ApplicationRecord | null>;
  updateCompanyApplicationStatus(
    id: string,
    jobId: string,
    expectedStatus: ApplicationStatus,
    nextStatus: ApplicationStatus,
  ): Promise<ApplicationRecord | null>;
}

const applicantApplicationColumns = `
  id, applicant_id, job_id, cover_letter, status, submitted_at,
  job:jobs!applications_job_id_fkey!inner(
    id, company_id, title, employment_type, location, deadline,
    company:companies!jobs_company_id_fkey(company_name)
  ),
  documentLinks:application_document_links!application_document_links_application_id_fkey(
    document:application_documents!application_document_links_document_id_fkey(
      id, file_name, file_size, mime_type
    )
  )
`;

const companyApplicationColumns = `
  ${applicantApplicationColumns},
  applicant:applicant_profiles!applications_applicant_id_fkey(
    headline,
    user:users!applicant_profiles_user_id_fkey(full_name)
  )
`;

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

function relationRecord(value: unknown, message: string): Record<string, unknown> {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!isRecord(candidate)) {
    throwDatabaseError(message);
  }
  return candidate;
}

function nullableString(value: unknown, message: string): string | null {
  if (value !== null && typeof value !== "string") {
    throwDatabaseError(message);
  }
  return value;
}

function isApplicationCvMimeType(
  value: unknown,
): value is ApplicationDocumentMetadata["mimeType"] {
  return (
    value === "application/pdf" ||
    value ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

function toApplicationRecord(value: unknown): ApplicationRecord {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.applicant_id !== "string" ||
    typeof value.job_id !== "string" ||
    (value.cover_letter !== null && typeof value.cover_letter !== "string") ||
    (value.status !== "TERKIRIM" &&
      value.status !== "DITINJAU" &&
      value.status !== "WAWANCARA" &&
      value.status !== "DITERIMA" &&
      value.status !== "DITOLAK") ||
    typeof value.submitted_at !== "string" ||
    !Array.isArray(value.documentLinks)
  ) {
    throwDatabaseError("Data lamaran tidak valid.");
  }

  const job = relationRecord(value.job, "Data lowongan pada lamaran tidak valid.");
  const company = relationRecord(
    job.company,
    "Data perusahaan pada lamaran tidak valid.",
  );
  if (
    typeof job.id !== "string" ||
    typeof job.title !== "string" ||
    typeof company.company_name !== "string"
  ) {
    throwDatabaseError("Data lowongan pada lamaran tidak valid.");
  }

  const documents = value.documentLinks.map((linkValue) => {
    if (!isRecord(linkValue)) {
      throwDatabaseError("Metadata CV pada lamaran tidak valid.");
    }
    const document = relationRecord(
      linkValue.document,
      "Metadata CV pada lamaran tidak valid.",
    );
    const mimeType = document.mime_type;
    if (
      typeof document.id !== "string" ||
      typeof document.file_name !== "string" ||
      typeof document.file_size !== "number" ||
      !Number.isSafeInteger(document.file_size) ||
      !isApplicationCvMimeType(mimeType)
    ) {
      throwDatabaseError("Metadata CV pada lamaran tidak valid.");
    }
    return {
      id: document.id,
      fileName: document.file_name,
      fileSize: document.file_size,
      mimeType,
    };
  });

  let applicant: ApplicationRecord["applicant"] = null;
  if (value.applicant !== undefined) {
    const applicantRecord = relationRecord(
      value.applicant,
      "Data applicant pada lamaran tidak valid.",
    );
    const user = relationRecord(
      applicantRecord.user,
      "Data applicant pada lamaran tidak valid.",
    );
    if (typeof user.full_name !== "string") {
      throwDatabaseError("Data applicant pada lamaran tidak valid.");
    }
    applicant = {
      fullName: user.full_name,
      headline: nullableString(
        applicantRecord.headline,
        "Data applicant pada lamaran tidak valid.",
      ),
    };
  }

  return {
    id: value.id,
    applicantId: value.applicant_id,
    jobId: value.job_id,
    coverLetter: value.cover_letter,
    status: value.status,
    submittedAt: value.submitted_at,
    job: {
      id: job.id,
      title: job.title,
      employmentType: nullableString(
        job.employment_type,
        "Data lowongan pada lamaran tidak valid.",
      ),
      location: nullableString(
        job.location,
        "Data lowongan pada lamaran tidak valid.",
      ),
      deadline: nullableString(
        job.deadline,
        "Data lowongan pada lamaran tidak valid.",
      ),
      companyName: company.company_name,
    },
    documents,
    applicant,
  };
}

function toSubmittedApplication(value: unknown): SubmittedApplication {
  const row = Array.isArray(value) ? value[0] : value;
  if (
    !isRecord(row) ||
    typeof row.application_id !== "string" ||
    typeof row.applicant_id !== "string" ||
    typeof row.job_id !== "string" ||
    (row.cover_letter !== null && typeof row.cover_letter !== "string") ||
    row.status !== "TERKIRIM" ||
    typeof row.submitted_at !== "string" ||
    typeof row.document_id !== "string"
  ) {
    throwDatabaseError("Hasil pembuatan lamaran tidak valid.");
  }
  return {
    id: row.application_id,
    applicantId: row.applicant_id,
    jobId: row.job_id,
    coverLetter: row.cover_letter,
    status: row.status,
    submittedAt: row.submitted_at,
    documentId: row.document_id,
  };
}

function errorText(error: Record<string, unknown>): string {
  return [error.constraint, error.details, error.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

export function toApplicationHttpError(error: unknown): HttpError {
  if (isRecord(error) && typeof error.code === "string") {
    const diagnostics = errorText(error);
    if (
      error.code === "23505" &&
      diagnostics.includes("applications_applicant_job_unique")
    ) {
      return new HttpError(409, "Lamaran untuk lowongan ini sudah pernah dikirim.");
    }
    if (error.code === "23514" && /active jobs|deadline has passed/i.test(diagnostics)) {
      return new HttpError(409, "Lowongan tidak lagi menerima lamaran.");
    }
    if (error.code === "P0002") {
      return new HttpError(404, "Lowongan atau CV tidak ditemukan atau tidak dapat digunakan.");
    }
    if (error.code === "22004") {
      return new HttpError(400, "Lowongan dan CV wajib dipilih.");
    }
  }
  return new HttpError(503, "Lamaran tidak dapat diproses.");
}

export class SupabaseApplicationsRepository
  implements ApplicationsRepositoryContract
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

  async findCompanyProfileId(userId: string): Promise<string | null> {
    const { data, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("companies")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle(),
      "Profil perusahaan tidak dapat diperiksa.",
    );
    if (error || (data !== null && (!isRecord(data) || typeof data.id !== "string"))) {
      throwDatabaseError("Profil perusahaan tidak dapat diperiksa.");
    }
    return data ? data.id : null;
  }

  async submitApplication(
    input: SubmitApplicationRepositoryInput,
  ): Promise<SubmittedApplication> {
    const result = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient().rpc("submit_job_application", {
          p_applicant_id: input.applicantId,
          p_job_id: input.jobId,
          p_document_id: input.cvId,
          p_cover_letter: input.coverLetter ?? null,
        }),
      "Lamaran tidak dapat dikirim.",
    );
    if (result.error) {
      throw toApplicationHttpError(result.error);
    }
    return toSubmittedApplication(result.data);
  }

  async listApplicantApplications(
    applicantId: string,
    query: ApplicationListQuery,
  ): Promise<ApplicationPage> {
    const { data, error, count } = await executeDatabaseRequest(
      () => {
        let request = getSupabaseAdminClient()
          .from("applications")
          .select(applicantApplicationColumns, { count: "exact" })
          .eq("applicant_id", applicantId);
        if (query.status) {
          request = request.eq("status", query.status);
        }
        return request
          .order("submitted_at", { ascending: false })
          .order("id", { ascending: false })
          .range(
            (query.page - 1) * query.pageSize,
            query.page * query.pageSize - 1,
          );
      },
      "Riwayat lamaran tidak dapat diambil.",
    );
    if (error || !Array.isArray(data) || count === null) {
      throwDatabaseError("Riwayat lamaran tidak dapat diambil.");
    }
    return {
      applications: data.map(toApplicationRecord),
      total: count,
    };
  }

  async findApplicantApplication(
    id: string,
    applicantId: string,
  ): Promise<ApplicationRecord | null> {
    const { data, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("applications")
          .select(applicantApplicationColumns)
          .eq("id", id)
          .eq("applicant_id", applicantId)
          .maybeSingle(),
      "Detail lamaran tidak dapat diambil.",
    );
    if (error) {
      throwDatabaseError("Detail lamaran tidak dapat diambil.");
    }
    return data ? toApplicationRecord(data) : null;
  }

  async listCompanyApplications(
    companyId: string,
    query: ApplicationListQuery,
  ): Promise<ApplicationPage> {
    const { data, error, count } = await executeDatabaseRequest(
      () => {
        let request = getSupabaseAdminClient()
          .from("applications")
          .select(companyApplicationColumns, { count: "exact" })
          .eq("job.company_id", companyId);
        if (query.status) {
          request = request.eq("status", query.status);
        }
        return request
          .order("submitted_at", { ascending: false })
          .order("id", { ascending: false })
          .range(
            (query.page - 1) * query.pageSize,
            query.page * query.pageSize - 1,
          );
      },
      "Daftar lamaran perusahaan tidak dapat diambil.",
    );
    if (error || !Array.isArray(data) || count === null) {
      throwDatabaseError("Daftar lamaran perusahaan tidak dapat diambil.");
    }
    return {
      applications: data.map(toApplicationRecord),
      total: count,
    };
  }

  async findCompanyApplication(
    id: string,
    companyId: string,
  ): Promise<ApplicationRecord | null> {
    const { data, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("applications")
          .select(companyApplicationColumns)
          .eq("id", id)
          .eq("job.company_id", companyId)
          .maybeSingle(),
      "Detail lamaran perusahaan tidak dapat diambil.",
    );
    if (error) {
      throwDatabaseError("Detail lamaran perusahaan tidak dapat diambil.");
    }
    return data ? toApplicationRecord(data) : null;
  }

  async updateCompanyApplicationStatus(
    id: string,
    jobId: string,
    expectedStatus: ApplicationStatus,
    nextStatus: ApplicationStatus,
  ): Promise<ApplicationRecord | null> {
    const { data, error } = await executeDatabaseRequest(
      () =>
        getSupabaseAdminClient()
          .from("applications")
          .update({ status: nextStatus })
          .eq("id", id)
          .eq("job_id", jobId)
          .eq("status", expectedStatus)
          .select(companyApplicationColumns)
          .maybeSingle(),
      "Status lamaran tidak dapat diperbarui.",
    );
    if (error) {
      throwDatabaseError("Status lamaran tidak dapat diperbarui.");
    }
    return data ? toApplicationRecord(data) : null;
  }
}
