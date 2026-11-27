import type {
  ApplicationPage,
  ApplicationRecord,
  ApplicationStatus,
  SubmittedApplication,
} from "../types/applications.types.js";
import type { ApplicationsRepositoryContract } from "../repositories/applications.repository.js";
import type {
  ApplicationListQuery,
  CreateApplicationInput,
} from "../validators/applications.validator.js";
import { HttpError } from "../utils/httpError.js";

const validStatusTransitions: Record<
  ApplicationStatus,
  readonly ApplicationStatus[]
> = {
  TERKIRIM: ["DITINJAU", "DITOLAK"],
  DITINJAU: ["WAWANCARA", "DITERIMA", "DITOLAK"],
  WAWANCARA: ["DITERIMA", "DITOLAK"],
  DITERIMA: [],
  DITOLAK: [],
};

export interface ApplicationsServiceContract {
  submit(userId: string, input: CreateApplicationInput): Promise<SubmittedApplication>;
  listApplicant(
    userId: string,
    query: ApplicationListQuery,
  ): Promise<ApplicationPage>;
  getApplicant(userId: string, id: string): Promise<ApplicationRecord>;
  listCompany(
    userId: string,
    query: ApplicationListQuery,
  ): Promise<ApplicationPage>;
  getCompany(userId: string, id: string): Promise<ApplicationRecord>;
  updateCompanyStatus(
    userId: string,
    id: string,
    nextStatus: ApplicationStatus,
  ): Promise<ApplicationRecord>;
}

export class ApplicationsService implements ApplicationsServiceContract {
  constructor(private readonly repository: ApplicationsRepositoryContract) {}

  async submit(
    userId: string,
    input: CreateApplicationInput,
  ): Promise<SubmittedApplication> {
    const applicantId = await this.getApplicantProfileId(userId);
    return this.repository.submitApplication({
      applicantId,
      jobId: input.jobId,
      cvId: input.cvId,
      coverLetter: input.coverLetter,
    });
  }

  async listApplicant(
    userId: string,
    query: ApplicationListQuery,
  ): Promise<ApplicationPage> {
    const applicantId = await this.getApplicantProfileId(userId);
    return this.repository.listApplicantApplications(applicantId, query);
  }

  async getApplicant(userId: string, id: string): Promise<ApplicationRecord> {
    const applicantId = await this.getApplicantProfileId(userId);
    const application = await this.repository.findApplicantApplication(
      id,
      applicantId,
    );
    if (!application) {
      throw new HttpError(404, "Lamaran tidak ditemukan.");
    }
    return application;
  }

  async listCompany(
    userId: string,
    query: ApplicationListQuery,
  ): Promise<ApplicationPage> {
    const companyId = await this.getCompanyProfileId(userId);
    return this.repository.listCompanyApplications(companyId, query);
  }

  async getCompany(userId: string, id: string): Promise<ApplicationRecord> {
    const companyId = await this.getCompanyProfileId(userId);
    const application = await this.repository.findCompanyApplication(
      id,
      companyId,
    );
    if (!application) {
      throw new HttpError(404, "Lamaran tidak ditemukan.");
    }
    return application;
  }

  async updateCompanyStatus(
    userId: string,
    id: string,
    nextStatus: ApplicationStatus,
  ): Promise<ApplicationRecord> {
    const companyId = await this.getCompanyProfileId(userId);
    const currentApplication = await this.repository.findCompanyApplication(
      id,
      companyId,
    );
    if (!currentApplication) {
      throw new HttpError(404, "Lamaran tidak ditemukan.");
    }
    if (!validStatusTransitions[currentApplication.status].includes(nextStatus)) {
      throw new HttpError(409, "Transisi status lamaran tidak valid.");
    }

    const updatedApplication =
      await this.repository.updateCompanyApplicationStatus(
        id,
        currentApplication.jobId,
        currentApplication.status,
        nextStatus,
      );
    if (!updatedApplication) {
      throw new HttpError(
        409,
        "Status lamaran berubah. Muat ulang data sebelum mencoba kembali.",
      );
    }
    return updatedApplication;
  }

  private async getApplicantProfileId(userId: string): Promise<string> {
    const applicantId = await this.repository.findApplicantProfileId(userId);
    if (!applicantId) {
      throw new HttpError(404, "Profil applicant tidak ditemukan.");
    }
    return applicantId;
  }

  private async getCompanyProfileId(userId: string): Promise<string> {
    const companyId = await this.repository.findCompanyProfileId(userId);
    if (!companyId) {
      throw new HttpError(404, "Profil perusahaan tidak ditemukan.");
    }
    return companyId;
  }
}
