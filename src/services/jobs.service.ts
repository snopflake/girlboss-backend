import type {
  JobPage,
  JobsRepositoryContract,
} from "../repositories/jobs.repository.js";
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

const validStatusTransitions: Record<JobStatus, readonly JobStatus[]> = {
  DRAFT: ["ACTIVE", "CLOSED"],
  ACTIVE: ["CLOSED"],
  CLOSED: [],
};

function currentDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface JobsServiceContract {
  listPublicJobs(query: JobListQuery): Promise<JobPage>;
  getPublicJob(id: string): Promise<JobRecord>;
  createCompanyJob(userId: string, input: CreateJobInput): Promise<JobRecord>;
  listCompanyJobs(userId: string, page: number, pageSize: number): Promise<JobPage>;
  updateCompanyJob(
    userId: string,
    id: string,
    input: UpdateJobInput,
  ): Promise<JobRecord>;
  updateCompanyJobStatus(
    userId: string,
    id: string,
    status: JobStatus,
  ): Promise<JobRecord>;
}

export class JobsService implements JobsServiceContract {
  constructor(private readonly repository: JobsRepositoryContract) {}

  async listPublicJobs(query: JobListQuery): Promise<JobPage> {
    return this.repository.findPublicJobs(query, currentDate());
  }

  async getPublicJob(id: string): Promise<JobRecord> {
    const job = await this.repository.findPublicJobById(id, currentDate());
    if (!job) {
      throw new HttpError(404, "Lowongan tidak ditemukan.");
    }
    return job;
  }

  async createCompanyJob(
    userId: string,
    input: CreateJobInput,
  ): Promise<JobRecord> {
    const company = await this.getCompanyProfile(userId);
    return this.repository.createCompanyJob(company.id, input);
  }

  async listCompanyJobs(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<JobPage> {
    const company = await this.getCompanyProfile(userId);
    return this.repository.findCompanyJobs(company.id, page, pageSize);
  }

  async updateCompanyJob(
    userId: string,
    id: string,
    input: UpdateJobInput,
  ): Promise<JobRecord> {
    const company = await this.getCompanyProfile(userId);
    const job = await this.repository.updateCompanyJob(id, company.id, input);
    if (!job) {
      throw new HttpError(404, "Lowongan tidak ditemukan.");
    }
    return job;
  }

  async updateCompanyJobStatus(
    userId: string,
    id: string,
    status: JobStatus,
  ): Promise<JobRecord> {
    const company = await this.getCompanyProfile(userId);
    const currentJob = await this.repository.findCompanyJobById(id, company.id);
    if (!currentJob) {
      throw new HttpError(404, "Lowongan tidak ditemukan.");
    }
    if (!validStatusTransitions[currentJob.status].includes(status)) {
      throw new HttpError(409, "Transisi status lowongan tidak valid.");
    }
    if (status === "ACTIVE") {
      if (company.verificationStatus !== "VERIFIED") {
        throw new HttpError(403, "Perusahaan belum terverifikasi untuk memublikasikan lowongan.");
      }
      if (
        currentJob.title.trim().length === 0 ||
        (currentJob.deadline !== null && currentJob.deadline < currentDate())
      ) {
        throw new HttpError(400, "Data lowongan tidak memenuhi syarat publikasi.");
      }
    }

    const updatedJob = await this.repository.updateCompanyJobStatus(
      id,
      company.id,
      status,
    );
    if (!updatedJob) {
      throw new HttpError(404, "Lowongan tidak ditemukan.");
    }
    return updatedJob;
  }

  private async getCompanyProfile(userId: string): Promise<CompanyJobProfile> {
    const company = await this.repository.findCompanyByUserId(userId);
    if (!company) {
      throw new HttpError(404, "Profil perusahaan tidak ditemukan.");
    }
    return company;
  }
}
