import type { z } from "zod";
import { HttpError } from "../utils/httpError.js";

export interface GeminiFailureMessages {
  notConfigured: string;
  unavailable: string;
  quota: string;
  provider: string;
  response: string;
  noContent: string;
  invalidJson: string;
  invalidResult: string;
}

export interface GeminiJsonRequest<T> {
  systemInstruction: string;
  prompt: string;
  responseSchema: Record<string, unknown>;
  outputSchema: z.ZodType<T>;
  temperature: number;
  maxOutputTokens: number;
  errors: GeminiFailureMessages;
}

const defaultErrors: GeminiFailureMessages = {
  notConfigured: "Gemini belum dikonfigurasi di backend.",
  unavailable: "Gemini tidak dapat dihubungi atau waktu permintaan habis.",
  quota: "Kuota Gemini sedang terbatas. Coba kembali nanti.",
  provider: "Gemini gagal memproses permintaan.",
  response: "Respons Gemini tidak valid.",
  noContent: "Gemini tidak menghasilkan respons.",
  invalidJson: "Respons JSON Gemini tidak valid.",
  invalidResult: "Format hasil Gemini tidak valid.",
};

const GEMINI_TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getResponseText(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.candidates)) {
    return null;
  }
  const firstCandidate = value.candidates[0];
  if (!isRecord(firstCandidate) || !isRecord(firstCandidate.content)) {
    return null;
  }
  const parts = firstCandidate.content.parts;
  if (!Array.isArray(parts)) {
    return null;
  }
  const textParts = parts.flatMap((part) =>
    isRecord(part) && typeof part.text === "string" ? [part.text] : [],
  );
  return textParts.length > 0 ? textParts.join("") : null;
}

export class GeminiJsonGenerator {
  constructor(
    private readonly apiKey?: string,
    private readonly model?: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.model);
  }

  async generate<T>(request: GeminiJsonRequest<T>): Promise<T> {
    if (!this.apiKey || !this.model) {
      throw new HttpError(503, request.errors.notConfigured);
    }

    let response: Response;
    try {
      response = await this.fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: request.systemInstruction }],
            },
            contents: [
              {
                role: "user",
                parts: [{ text: request.prompt }],
              },
            ],
            generationConfig: {
              temperature: request.temperature,
              maxOutputTokens: request.maxOutputTokens,
              responseMimeType: "application/json",
              responseSchema: request.responseSchema,
            },
          }),
        },
      );
    } catch {
      throw new HttpError(503, request.errors.unavailable);
    }

    if (response.status === 429) {
      throw new HttpError(429, request.errors.quota);
    }
    if (!response.ok) {
      throw new HttpError(503, request.errors.provider);
    }

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      throw new HttpError(503, request.errors.response);
    }

    const responseText = getResponseText(responseBody);
    if (!responseText) {
      throw new HttpError(503, request.errors.noContent);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(responseText);
    } catch {
      throw new HttpError(503, request.errors.invalidJson);
    }
    const parsedResult = request.outputSchema.safeParse(parsedJson);
    if (!parsedResult.success) {
      throw new HttpError(503, request.errors.invalidResult);
    }
    return parsedResult.data;
  }
}

export { defaultErrors as defaultGeminiFailureMessages };
