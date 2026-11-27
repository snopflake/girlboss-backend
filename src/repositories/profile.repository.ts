import { getSupabaseAdminClient } from "../config/supabaseAdmin.js";
import type {
  ApplicantProfile,
  CompanyProfile,
} from "../types/profile.types.js";
import type {
  UpdateApplicantProfileInput,
  UpdateCompanyProfileInput,
} from "../validators/profile.validator.js";
import { HttpError } from "../utils/httpError.js";

export interface ProfileRepositoryContract {
  findApplicantProfile(userId: string): Promise<ApplicantProfile | null>;
  updateApplicantProfile(
    userId: string,
    input: UpdateApplicantProfileInput,
  ): Promise<ApplicantProfile | null>;
  findCompanyProfile(userId: string): Promise<CompanyProfile | null>;
  updateCompanyProfile(
    userId: string,
    input: UpdateCompanyProfileInput,
  ): Promise<CompanyProfile | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toApplicantProfile(value: unknown): ApplicantProfile {
  if (
    !isRecord(value) ||
    (value.headline !== null && typeof value.headline !== "string") ||
    (value.phone_number !== null && typeof value.phone_number !== "string") ||
    (value.professional_summary !== null &&
      typeof value.professional_summary !== "string")
  ) {
    throw new HttpError(503, "Data profil applicant tidak valid.");
  }

  return {
    headline: value.headline,
    phoneNumber: value.phone_number,
    professionalSummary: value.professional_summary,
  };
}

function toCompanyProfile(value: unknown): CompanyProfile {
  if (
    !isRecord(value) ||
    typeof value.company_name !== "string" ||
    (value.industry !== null && typeof value.industry !== "string")
  ) {
    throw new HttpError(503, "Data profil perusahaan tidak valid.");
  }

  return {
    companyName: value.company_name,
    industry: value.industry,
  };
}

async function executeDatabaseRequest<T>(
  createRequest: () => PromiseLike<T>,
): Promise<T> {
  try {
    return await createRequest();
  } catch {
    throw new HttpError(503, "Profil tidak dapat diproses.");
  }
}

const applicantProfileColumns = "headline, phone_number, professional_summary";
const companyProfileColumns = "company_name, industry";

export class SupabaseProfileRepository implements ProfileRepositoryContract {
  async findApplicantProfile(userId: string): Promise<ApplicantProfile | null> {
    const { data, error } = await executeDatabaseRequest(() =>
      getSupabaseAdminClient()
        .from("applicant_profiles")
        .select(applicantProfileColumns)
        .eq("user_id", userId)
        .maybeSingle(),
    );

    if (error) {
      throw new HttpError(503, "Profil applicant tidak dapat diambil.");
    }
    return data ? toApplicantProfile(data) : null;
  }

  async updateApplicantProfile(
    userId: string,
    input: UpdateApplicantProfileInput,
  ): Promise<ApplicantProfile | null> {
    const { data, error } = await executeDatabaseRequest(() =>
      getSupabaseAdminClient()
        .from("applicant_profiles")
        .update({
          ...(input.headline !== undefined ? { headline: input.headline } : {}),
          ...(input.phoneNumber !== undefined
            ? { phone_number: input.phoneNumber }
            : {}),
          ...(input.professionalSummary !== undefined
            ? { professional_summary: input.professionalSummary }
            : {}),
        })
        .eq("user_id", userId)
        .select(applicantProfileColumns)
        .maybeSingle(),
    );

    if (error) {
      throw new HttpError(503, "Profil applicant tidak dapat diperbarui.");
    }
    return data ? toApplicantProfile(data) : null;
  }

  async findCompanyProfile(userId: string): Promise<CompanyProfile | null> {
    const { data, error } = await executeDatabaseRequest(() =>
      getSupabaseAdminClient()
        .from("companies")
        .select(companyProfileColumns)
        .eq("user_id", userId)
        .maybeSingle(),
    );

    if (error) {
      throw new HttpError(503, "Profil perusahaan tidak dapat diambil.");
    }
    return data ? toCompanyProfile(data) : null;
  }

  async updateCompanyProfile(
    userId: string,
    input: UpdateCompanyProfileInput,
  ): Promise<CompanyProfile | null> {
    const { data, error } = await executeDatabaseRequest(() =>
      getSupabaseAdminClient()
        .from("companies")
        .update({
          ...(input.companyName !== undefined
            ? { company_name: input.companyName }
            : {}),
          ...(input.industry !== undefined ? { industry: input.industry } : {}),
        })
        .eq("user_id", userId)
        .select(companyProfileColumns)
        .maybeSingle(),
    );

    if (error) {
      throw new HttpError(503, "Profil perusahaan tidak dapat diperbarui.");
    }
    return data ? toCompanyProfile(data) : null;
  }
}
