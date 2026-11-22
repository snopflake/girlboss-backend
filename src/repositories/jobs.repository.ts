import { getSupabaseAdminClient } from "../config/supabaseAdmin.js";
import type {
  CompanyJobProfile,
  JobRecord,
  JobStatus,
} from "../types/jobs.types.js";
import type {
  CreateJobInput,
  JobListQuery,
  UpdateJobInput,
} from "../validators/jobs.validator.js";
import { HttpError } from "../utils/httpError.js";

export interface JobPage {
  jobs: JobRecord[];
  total: number;
}

export interface JobsRepositoryContract {
  findPublicJobs(
    query: JobListQuery,
    currentDate: string,
  ): Promise<JobPage>;
  findPublicJobById(id: string, currentDate: string): Promise<JobRecord | null>;
  findCompanyByUserId(userId: string): Promise<CompanyJobProfile | null>;
  createCompanyJob(companyId: string, input: CreateJobInput): Promise<JobRecord>;
  findCompanyJobs(
    companyId: string,
    page: number,
    pageSize: number,
  ): Promise<JobPage>;
  findCompanyJobById(id: string, companyId: string): Promise<JobRecord | null>;
  updateCompanyJob(
    id: string,
    companyId: string,
    input: UpdateJobInput,
  ): Promise<JobRecord | null>;
  updateCompanyJobStatus(
    id: string,
    companyId: string,
    status: JobStatus,
  ): Promise<JobRecord | null>;
}

const jobColumns =
  "id, company_id, title, employment_type, location, status, deadline";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toJobRecord(value: unknown): JobRecord {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.company_id !== "string" ||
    typeof value.title !== "string" ||
    (value.employment_type !== null &&
      typeof value.employment_type !== "string") ||
    (value.location !== null && typeof value.location !== "string") ||
    (value.status !== "DRAFT" &&
      value.status !== "ACTIVE" &&
      value.status !== "CLOSED") ||
    (value.deadline !== null && typeof value.deadline !== "string")
  ) {
    throw new HttpError(503, "Data lowongan tidak valid.");
  }

  return {
    id: value.id,
    companyId: value.company_id,
    title: value.title,
    employmentType: value.employment_type,
    location: value.location,
    status: value.status,
    deadline: value.deadline,
  };
}

function throwDatabaseError(): never {
  throw new HttpError(503, "Data lowongan tidak dapat diproses.");
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

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export class SupabaseJobsRepository implements JobsRepositoryContract {
  async findPublicJobs(
    query: JobListQuery,
    currentDate: string,
  ): Promise<JobPage> {
    const { data, error, count } = await executeDatabaseRequest(() => {
      let request = getSupabaseAdminClient()
        .from("jobs")
        .select(jobColumns, { count: "exact" })
        .eq("status", "ACTIVE")
        .or(`deadline.is.null,deadline.gte.${currentDate}`);

      if (query.search) {
        request = request.ilike(
          "title",
          `%${escapeLikePattern(query.search)}%`,
        );
      }
      if (query.employmentType) {
        request = request.eq("employment_type", query.employmentType);
      }
      if (query.location) {
        request = request.ilike(
          "location",
          `%${escapeLikePattern(query.location)}%`,
        );
      }

      return request
        .order("id", { ascending: true })
        .range(
          (query.page - 1) * query.pageSize,
          query.page * query.pageSize - 1,
        );
    });
    if (error || !Array.isArray(data) || count === null) {
      throwDatabaseError();
    }

    return { jobs: data.map(toJobRecord), total: count };
  }

  async findPublicJobById(
    id: string,
    currentDate: string,
  ): Promise<JobRecord | null> {
    const { data, error } = await executeDatabaseRequest(() =>
      getSupabaseAdminClient()
        .from("jobs")
        .select(jobColumns)
        .eq("id", id)
        .eq("status", "ACTIVE")
        .or(`deadline.is.null,deadline.gte.${currentDate}`)
        .maybeSingle(),
    );

    if (error) {
      throwDatabaseError();
    }
    return data ? toJobRecord(data) : null;
  }

  async findCompanyByUserId(userId: string): Promise<CompanyJobProfile | null> {
    const { data, error } = await executeDatabaseRequest(() =>
      getSupabaseAdminClient()
        .from("companies")
        .select("id, verification_status")
        .eq("user_id", userId)
        .maybeSingle(),
    );

    if (
      error ||
      (data !== null &&
        (!isRecord(data) ||
          typeof data.id !== "string" ||
          typeof data.verification_status !== "string"))
    ) {
      throwDatabaseError();
    }
    if (!data) {
      return null;
    }
    return {
      id: data.id,
      verificationStatus: data.verification_status,
    };
  }

  async createCompanyJob(
    companyId: string,
    input: CreateJobInput,
  ): Promise<JobRecord> {
    const { data, error } = await executeDatabaseRequest(() =>
      getSupabaseAdminClient()
        .from("jobs")
        .insert({
          company_id: companyId,
          title: input.title,
          employment_type: input.employmentType ?? null,
          location: input.location ?? null,
          status: "DRAFT",
          deadline: input.deadline ?? null,
        })
        .select(jobColumns)
        .single(),
    );

    if (error || !data) {
      throwDatabaseError();
    }
    return toJobRecord(data);
  }

  async findCompanyJobs(
    companyId: string,
    page: number,
    pageSize: number,
  ): Promise<JobPage> {
    const { data, error, count } = await executeDatabaseRequest(() =>
      getSupabaseAdminClient()
        .from("jobs")
        .select(jobColumns, { count: "exact" })
        .eq("company_id", companyId)
        .order("id", { ascending: true })
        .range((page - 1) * pageSize, page * pageSize - 1),
    );

    if (error || !Array.isArray(data) || count === null) {
      throwDatabaseError();
    }
    return { jobs: data.map(toJobRecord), total: count };
  }

  async findCompanyJobById(
    id: string,
    companyId: string,
  ): Promise<JobRecord | null> {
    const { data, error } = await executeDatabaseRequest(() =>
      getSupabaseAdminClient()
        .from("jobs")
        .select(jobColumns)
        .eq("id", id)
        .eq("company_id", companyId)
        .maybeSingle(),
    );

    if (error) {
      throwDatabaseError();
    }
    return data ? toJobRecord(data) : null;
  }

  async updateCompanyJob(
    id: string,
    companyId: string,
    input: UpdateJobInput,
  ): Promise<JobRecord | null> {
    const { data, error } = await executeDatabaseRequest(() =>
      getSupabaseAdminClient()
        .from("jobs")
        .update({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.employmentType !== undefined
            ? { employment_type: input.employmentType }
            : {}),
          ...(input.location !== undefined ? { location: input.location } : {}),
          ...(input.deadline !== undefined ? { deadline: input.deadline } : {}),
        })
        .eq("id", id)
        .eq("company_id", companyId)
        .select(jobColumns)
        .maybeSingle(),
    );

    if (error) {
      throwDatabaseError();
    }
    return data ? toJobRecord(data) : null;
  }

  async updateCompanyJobStatus(
    id: string,
    companyId: string,
    status: JobStatus,
  ): Promise<JobRecord | null> {
    const { data, error } = await executeDatabaseRequest(() =>
      getSupabaseAdminClient()
        .from("jobs")
        .update({ status })
        .eq("id", id)
        .eq("company_id", companyId)
        .select(jobColumns)
        .maybeSingle(),
    );

    if (error) {
      throwDatabaseError();
    }
    return data ? toJobRecord(data) : null;
  }
}
