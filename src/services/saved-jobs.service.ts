import type { SavedJobPage } from "../types/saved-jobs.types.js";
import type { SavedJobsRepositoryContract } from "../repositories/saved-jobs.repository.js";
import type {
  SaveJobInput,
  SavedJobListQuery,
} from "../validators/saved-jobs.validator.js";
import { HttpError } from "../utils/httpError.js";

export interface SavedJobsServiceContract {
  list(userId: string, query: SavedJobListQuery): Promise<SavedJobPage>;
  save(userId: string, input: SaveJobInput): Promise<{ jobId: string }>;
  remove(userId: string, jobId: string): Promise<void>;
}

export class SavedJobsService implements SavedJobsServiceContract {
  constructor(private readonly repository: SavedJobsRepositoryContract) {}

  async list(userId: string, query: SavedJobListQuery): Promise<SavedJobPage> {
    const applicantId = await this.getApplicantProfileId(userId);
    return this.repository.listSavedJobs(applicantId, query);
  }

  async save(
    userId: string,
    input: SaveJobInput,
  ): Promise<{ jobId: string }> {
    const applicantId = await this.getApplicantProfileId(userId);
    const jobStatus = await this.repository.findJobStatus(input.jobId);
    if (!jobStatus) {
      throw new HttpError(404, "Lowongan tidak ditemukan.");
    }
    if (jobStatus !== "ACTIVE") {
      throw new HttpError(409, "Hanya lowongan ACTIVE yang dapat disimpan.");
    }

    await this.repository.createSavedJob({
      applicantId,
      jobId: input.jobId,
    });
    return { jobId: input.jobId };
  }

  async remove(userId: string, jobId: string): Promise<void> {
    const applicantId = await this.getApplicantProfileId(userId);
    const removed = await this.repository.deleteSavedJob(applicantId, jobId);
    if (!removed) {
      throw new HttpError(404, "Lowongan tersimpan tidak ditemukan.");
    }
  }

  private async getApplicantProfileId(userId: string): Promise<string> {
    const applicantId = await this.repository.findApplicantProfileId(userId);
    if (!applicantId) {
      throw new HttpError(404, "Profil applicant tidak ditemukan.");
    }
    return applicantId;
  }
}
