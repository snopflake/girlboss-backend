export const cvMimeTypes = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export type CvMimeType = (typeof cvMimeTypes)[keyof typeof cvMimeTypes];

export interface CvMetadata {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: CvMimeType;
}

export interface CvDocumentRecord extends CvMetadata {
  applicantId: string;
  storageKey: string;
}

export interface CvUploadFile {
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}
