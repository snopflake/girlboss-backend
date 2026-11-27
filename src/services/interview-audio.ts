import { extname } from "node:path";
import type { SpeechDeliveryMetrics } from "../validators/interview-sessions.validator.js";
import { HttpError } from "../utils/httpError.js";
import type { PitchAnalysis } from "./wav-pitch-analyzer.js";

export const MAX_INTERVIEW_AUDIO_BYTES = 20 * 1024 * 1024;
export const MAX_INTERVIEW_AUDIO_DURATION_SECONDS = 180;

const allowedAudioTypes = ["audio/webm", "audio/wav", "audio/x-wav", "audio/ogg"] as const;
const PAUSE_THRESHOLD_SECONDS = 0.6;
const MIN_WORDS_FOR_SPEECH_RATE = 3;

export interface InterviewAudioFile {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

export interface InterviewTranscription {
  text: string;
  durationSeconds: number | null;
  segments: TranscriptionSegment[] | null;
}

export interface InterviewAudioTranscriberContract {
  isConfigured(): boolean;
  transcribe(file: InterviewAudioFile): Promise<InterviewTranscription>;
}

export interface InterviewAudioInspection {
  mimeType: "audio/webm" | "audio/wav" | "audio/ogg";
  preflightDurationSeconds: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeMimeType(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isAllowedAudioType(
  mimeType: string,
): mimeType is (typeof allowedAudioTypes)[number] {
  return (allowedAudioTypes as readonly string[]).includes(mimeType);
}

function hasSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === "audio/webm") {
    return buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  }
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") {
    return (
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WAVE"
    );
  }
  return buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "OggS";
}

function wavDurationSeconds(buffer: Buffer): number | null {
  let byteRate: number | null = null;
  let dataSize: number | null = null;
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const chunkName = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkSize > buffer.length - chunkStart) {
      return null;
    }

    if (chunkName === "fmt " && chunkSize >= 16) {
      byteRate = buffer.readUInt32LE(chunkStart + 8);
    }
    if (chunkName === "data") {
      dataSize = chunkSize;
    }
    if (byteRate !== null && dataSize !== null) {
      break;
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (!byteRate || dataSize === null) {
    return null;
  }
  return dataSize / byteRate;
}

export function inspectInterviewAudio(
  file: InterviewAudioFile,
): InterviewAudioInspection {
  if (
    file.buffer.length === 0 ||
    file.buffer.length > MAX_INTERVIEW_AUDIO_BYTES
  ) {
    throw new HttpError(413, "Ukuran rekaman wawancara tidak valid atau melebihi batas.");
  }

  const mimeType = normalizeMimeType(file.mimeType);
  if (!isAllowedAudioType(mimeType)) {
    throw new HttpError(400, "Format audio harus WebM, WAV, atau OGG.");
  }

  const extension = extname(file.originalName).toLowerCase();
  const acceptedExtensions: Record<string, string[]> = {
    "audio/webm": [".webm"],
    "audio/wav": [".wav", ".wave"],
    "audio/x-wav": [".wav", ".wave"],
    "audio/ogg": [".ogg", ".oga"],
  };
  if (
    extension &&
    !acceptedExtensions[mimeType]?.includes(extension)
  ) {
    throw new HttpError(400, "Ekstensi rekaman tidak sesuai dengan MIME audio.");
  }

  if (!hasSignature(file.buffer, mimeType)) {
    throw new HttpError(400, "Signature file tidak sesuai dengan format audio.");
  }

  const normalizedType =
    mimeType === "audio/x-wav" ? "audio/wav" : mimeType;
  const duration =
    normalizedType === "audio/wav" ? wavDurationSeconds(file.buffer) : null;
  if (
    duration !== null &&
    duration > MAX_INTERVIEW_AUDIO_DURATION_SECONDS
  ) {
    throw new HttpError(413, "Durasi rekaman melebihi batas 180 detik.");
  }

  return {
    mimeType: normalizedType,
    preflightDurationSeconds: duration,
  };
}

function parseSegments(value: unknown): TranscriptionSegment[] | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }
  const segments: TranscriptionSegment[] = [];
  for (const segment of value) {
    if (
      !isRecord(segment) ||
      typeof segment.start !== "number" ||
      !Number.isFinite(segment.start) ||
      typeof segment.end !== "number" ||
      !Number.isFinite(segment.end) ||
      typeof segment.text !== "string" ||
      segment.start < 0 ||
      segment.end <= segment.start
    ) {
      return null;
    }
    segments.push({
      start: segment.start,
      end: segment.end,
      text: segment.text,
    });
  }
  return segments;
}

export class GroqWhisperTranscriber implements InterviewAudioTranscriberContract {
  constructor(
    private readonly apiKey?: string,
    private readonly model?: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.model);
  }

  async transcribe(file: InterviewAudioFile): Promise<InterviewTranscription> {
    if (!this.apiKey || !this.model) {
      throw new HttpError(503, "Transkripsi Groq belum dikonfigurasi di backend.");
    }

    const inspection = inspectInterviewAudio(file);
    const formData = new FormData();
    const extension =
      inspection.mimeType === "audio/webm"
        ? "webm"
        : inspection.mimeType === "audio/ogg"
          ? "ogg"
          : "wav";
    formData.append(
      "file",
      new Blob([new Uint8Array(file.buffer)], { type: inspection.mimeType }),
      `interview.${extension}`,
    );
    formData.append("model", this.model);
    formData.append("response_format", "verbose_json");
    formData.append("timestamp_granularities[]", "segment");

    let response: Response;
    try {
      response = await this.fetcher(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        {
          method: "POST",
          headers: { authorization: `Bearer ${this.apiKey}` },
          body: formData,
          signal: AbortSignal.timeout(60_000),
        },
      );
    } catch {
      throw new HttpError(503, "Groq tidak dapat dihubungi atau waktu transkripsi habis.");
    }

    if (response.status === 429) {
      throw new HttpError(429, "Kuota transkripsi sedang terbatas. Coba kembali nanti.");
    }
    if (!response.ok) {
      throw new HttpError(503, "Groq gagal mentranskripsikan rekaman.");
    }

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new HttpError(503, "Respons transkripsi tidak valid.");
    }
    if (!isRecord(result) || typeof result.text !== "string") {
      throw new HttpError(503, "Respons transkripsi tidak valid.");
    }

    const durationSeconds =
      typeof result.duration === "number" &&
      Number.isFinite(result.duration) &&
      result.duration > 0
        ? result.duration
        : null;
    return {
      text: result.text.trim(),
      durationSeconds,
      segments: parseSegments(result.segments),
    };
  }
}

export function buildSpeechDeliveryMetrics(
  transcription: InterviewTranscription,
  pitch: PitchAnalysis = {
    medianPitchHz: null,
    variationSemitones: null,
    voicedFrameCount: 0,
    status: "UNSUPPORTED_FORMAT",
  },
): SpeechDeliveryMetrics {
  const duration = transcription.durationSeconds;
  const words =
    transcription.text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
  const speechRateAvailable =
    duration !== null &&
    Number.isFinite(duration) &&
    duration > 0 &&
    words.length >= MIN_WORDS_FOR_SPEECH_RATE;
  const wordsPerMinute = speechRateAvailable
    ? Math.round((words.length / (duration / 60)) * 10) / 10
    : null;

  let pauseCount: number | null = null;
  let totalPauseSeconds: number | null = null;
  let pauseStatus: SpeechDeliveryMetrics["pauseStatus"] =
    "INSUFFICIENT_SEGMENTS";
  if (transcription.segments && transcription.segments.length >= 2 && duration) {
    const ordered = [...transcription.segments].sort(
      (left, right) => left.start - right.start,
    );
    const validSegments = ordered.every(
      (segment) =>
        segment.start >= 0 &&
        segment.end <= duration &&
        segment.end > segment.start,
    );
    if (validSegments) {
      const pauses = ordered.slice(1).flatMap((segment, index) => {
        const gap = segment.start - ordered[index]!.end;
        return gap >= PAUSE_THRESHOLD_SECONDS ? [gap] : [];
      });
      pauseCount = pauses.length;
      totalPauseSeconds =
        Math.round(pauses.reduce((total, pause) => total + pause, 0) * 10) /
        10;
      pauseStatus = "ESTIMATED_FROM_SEGMENTS";
    } else {
      pauseStatus = "UNAVAILABLE";
    }
  }

  const feedback: string[] = [];
  if (wordsPerMinute === null) {
    feedback.push("Kecepatan bicara belum dapat dinilai dari transkrip yang tersedia.");
  } else if (wordsPerMinute < 100) {
    feedback.push(
      `Terukur sekitar ${wordsPerMinute} kata per menit; coba tingkatkan tempo sedikit saat latihan.`,
    );
  } else if (wordsPerMinute > 170) {
    feedback.push(
      `Terukur sekitar ${wordsPerMinute} kata per menit; coba perlambat tempo agar jawaban lebih mudah diikuti.`,
    );
  } else {
    feedback.push(
      `Terukur sekitar ${wordsPerMinute} kata per menit; gunakan angka ini sebagai patokan latihan, bukan penilaian mutlak.`,
    );
  }
  if (pauseCount === null) {
    feedback.push("Jeda belum dapat diperkirakan dari timestamp segmen transkripsi.");
  } else if (pauseCount > 2) {
    feedback.push(
      `Diperkirakan ${pauseCount} gap antar-segmen Whisper berjumlah ${totalPauseSeconds} detik; ini bukan deteksi hening akustik.`,
    );
  } else {
    feedback.push(
      `Diperkirakan ${pauseCount} gap antar-segmen Whisper memenuhi ambang 0,6 detik; ini bukan deteksi hening akustik.`,
    );
  }

  const pitchFeedback =
    pitch.status === "MEASURED"
      ? `Median pitch terukur ${pitch.medianPitchHz} Hz dengan rentang variasi IQR ${pitch.variationSemitones} semiton dari ${pitch.voicedFrameCount} frame bersuara valid. Gunakan hanya sebagai bahan observasi intonasi latihan.`
      : pitch.status === "INSUFFICIENT_VOICED_FRAMES"
        ? "Pitch tidak dinilai karena frame bersuara valid tidak mencukupi."
        : "Pitch tidak tersedia untuk format atau encoding audio ini.";

  return {
    durationSeconds: duration,
    durationStatus: duration === null ? "UNAVAILABLE" : "MEASURED",
    wordCount: words.length > 0 ? words.length : null,
    wordsPerMinute,
    speechRateStatus:
      wordsPerMinute !== null
        ? "MEASURED"
        : words.length < MIN_WORDS_FOR_SPEECH_RATE
          ? "INSUFFICIENT_TRANSCRIPT"
          : "UNAVAILABLE",
    pauseCount,
    totalPauseSeconds,
    pauseStatus,
    ...(pauseStatus === "ESTIMATED_FROM_SEGMENTS"
      ? {
          pauseSource: "WHISPER_SEGMENT_TIMESTAMPS" as const,
          pauseThresholdSeconds: PAUSE_THRESHOLD_SECONDS,
        }
      : {}),
    pitchMedianHz: pitch.medianPitchHz,
    pitchVariation: pitch.variationSemitones,
    pitchVariationUnit: "semitones",
    voicedFrameCount: pitch.voicedFrameCount,
    pitchStatus: pitch.status,
    pitchFeedback,
    deliveryFeedback: feedback.join(" "),
  };
}
