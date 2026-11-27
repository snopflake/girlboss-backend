import type {
  ProfileRepositoryContract,
} from "../repositories/profile.repository.js";
import type {
  ApplicantProfile,
  CompanyProfile,
} from "../types/profile.types.js";
import type {
  UpdateApplicantProfileInput,
  UpdateCompanyProfileInput,
} from "../validators/profile.validator.js";
import { HttpError } from "../utils/httpError.js";

export interface ProfileServiceContract {
  getApplicantProfile(userId: string): Promise<ApplicantProfile>;
  updateApplicantProfile(
    userId: string,
    input: UpdateApplicantProfileInput,
  ): Promise<ApplicantProfile>;
  getCompanyProfile(userId: string): Promise<CompanyProfile>;
  updateCompanyProfile(
    userId: string,
    input: UpdateCompanyProfileInput,
  ): Promise<CompanyProfile>;
}

export class ProfileService implements ProfileServiceContract {
  constructor(private readonly repository: ProfileRepositoryContract) {}

  async getApplicantProfile(userId: string): Promise<ApplicantProfile> {
    const profile = await this.repository.findApplicantProfile(userId);
    if (!profile) {
      throw new HttpError(404, "Profil applicant tidak ditemukan.");
    }
    return profile;
  }

  async updateApplicantProfile(
    userId: string,
    input: UpdateApplicantProfileInput,
  ): Promise<ApplicantProfile> {
    const profile = await this.repository.updateApplicantProfile(userId, input);
    if (!profile) {
      throw new HttpError(404, "Profil applicant tidak ditemukan.");
    }
    return profile;
  }

  async getCompanyProfile(userId: string): Promise<CompanyProfile> {
    const profile = await this.repository.findCompanyProfile(userId);
    if (!profile) {
      throw new HttpError(404, "Profil perusahaan tidak ditemukan.");
    }
    return profile;
  }

  async updateCompanyProfile(
    userId: string,
    input: UpdateCompanyProfileInput,
  ): Promise<CompanyProfile> {
    const profile = await this.repository.updateCompanyProfile(userId, input);
    if (!profile) {
      throw new HttpError(404, "Profil perusahaan tidak ditemukan.");
    }
    return profile;
  }
}
