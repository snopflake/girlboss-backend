export type PitchAnalysisStatus =
  | "MEASURED"
  | "INSUFFICIENT_VOICED_FRAMES"
  | "UNSUPPORTED_FORMAT";

export interface PitchAnalysis {
  medianPitchHz: number | null;
  variationSemitones: number | null;
  voicedFrameCount: number;
  status: PitchAnalysisStatus;
}

interface PcmWavData {
  audioFormat: number;
  bitsPerSample: number;
  blockAlign: number;
  channels: number;
  dataOffset: number;
  dataSize: number;
  sampleRate: number;
}

const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 96_000;
const MIN_PITCH_HZ = 60;
const MAX_PITCH_HZ = 500;
const MIN_VOICED_RMS = 0.008;
const MAX_CLIPPED_SAMPLE_RATIO = 0.02;
const YIN_THRESHOLD = 0.15;
const MIN_YIN_CONFIDENCE = 0.8;
const MIN_VOICED_FRAMES = 5;
const MAX_AUDIO_SECONDS = 180;
const ANALYSIS_SAMPLE_RATE = 8_000;
const FRAME_DURATION_SECONDS = 0.04;
const FRAME_HOP_SECONDS = 0.02;

function parsePcmWav(buffer: Buffer): PcmWavData | null {
  if (
    buffer.length < 44 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return null;
  }

  let audioFormat: number | null = null;
  let bitsPerSample: number | null = null;
  let blockAlign: number | null = null;
  let channels: number | null = null;
  let dataOffset: number | null = null;
  let dataSize: number | null = null;
  let sampleRate: number | null = null;
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const chunkName = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkSize > buffer.length - chunkStart) {
      return null;
    }

    if (chunkName === "fmt " && chunkSize >= 16) {
      audioFormat = buffer.readUInt16LE(chunkStart);
      channels = buffer.readUInt16LE(chunkStart + 2);
      sampleRate = buffer.readUInt32LE(chunkStart + 4);
      blockAlign = buffer.readUInt16LE(chunkStart + 12);
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
    } else if (chunkName === "data") {
      dataOffset = chunkStart;
      dataSize = chunkSize;
    }
    if (
      audioFormat !== null &&
      bitsPerSample !== null &&
      blockAlign !== null &&
      channels !== null &&
      dataOffset !== null &&
      dataSize !== null &&
      sampleRate !== null
    ) {
      break;
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (
    audioFormat === null ||
    bitsPerSample === null ||
    blockAlign === null ||
    channels === null ||
    dataOffset === null ||
    dataSize === null ||
    sampleRate === null ||
    channels < 1 ||
    channels > 2 ||
    sampleRate < MIN_SAMPLE_RATE ||
    sampleRate > MAX_SAMPLE_RATE ||
    blockAlign !== channels * (bitsPerSample / 8) ||
    dataSize % blockAlign !== 0 ||
    dataSize === 0
  ) {
    return null;
  }

  const isPcmInteger =
    audioFormat === 1 && [8, 16, 24, 32].includes(bitsPerSample);
  const isPcmFloat =
    audioFormat === 3 && [32, 64].includes(bitsPerSample);
  if (!isPcmInteger && !isPcmFloat) {
    return null;
  }
  if (dataSize / blockAlign / sampleRate > MAX_AUDIO_SECONDS) {
    return null;
  }

  return {
    audioFormat,
    bitsPerSample,
    blockAlign,
    channels,
    dataOffset,
    dataSize,
    sampleRate,
  };
}

function readPcmSample(
  buffer: Buffer,
  offset: number,
  audioFormat: number,
  bitsPerSample: number,
): number {
  if (audioFormat === 3) {
    const value =
      bitsPerSample === 32
        ? buffer.readFloatLE(offset)
        : buffer.readDoubleLE(offset);
    return Number.isFinite(value) ? value : 0;
  }

  if (bitsPerSample === 8) {
    return (buffer.readUInt8(offset) - 128) / 128;
  }
  if (bitsPerSample === 16) {
    return buffer.readInt16LE(offset) / 32_768;
  }
  if (bitsPerSample === 24) {
    let value =
      buffer.readUInt8(offset) |
      (buffer.readUInt8(offset + 1) << 8) |
      (buffer.readUInt8(offset + 2) << 16);
    if (value & 0x800000) {
      value |= ~0xffffff;
    }
    return value / 8_388_608;
  }
  return buffer.readInt32LE(offset) / 2_147_483_648;
}

function downsampleToMono(
  buffer: Buffer,
  wav: PcmWavData,
): { samples: Float32Array; sampleRate: number } {
  const frameCount = wav.dataSize / wav.blockAlign;
  const factor = Math.max(1, Math.ceil(wav.sampleRate / ANALYSIS_SAMPLE_RATE));
  const outputCount = Math.ceil(frameCount / factor);
  const samples = new Float32Array(outputCount);
  const bytesPerSample = wav.bitsPerSample / 8;

  for (let outputIndex = 0; outputIndex < outputCount; outputIndex += 1) {
    const firstFrame = outputIndex * factor;
    const lastFrame = Math.min(firstFrame + factor, frameCount);
    let total = 0;
    let count = 0;
    for (let frameIndex = firstFrame; frameIndex < lastFrame; frameIndex += 1) {
      const frameOffset = wav.dataOffset + frameIndex * wav.blockAlign;
      for (let channel = 0; channel < wav.channels; channel += 1) {
        total += readPcmSample(
          buffer,
          frameOffset + channel * bytesPerSample,
          wav.audioFormat,
          wav.bitsPerSample,
        );
        count += 1;
      }
    }
    samples[outputIndex] = count > 0 ? total / count : 0;
  }

  return { samples, sampleRate: wav.sampleRate / factor };
}

function interpolatePitch(
  frame: Float64Array,
  sampleRate: number,
): number | null {
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_PITCH_HZ));
  const maxLag = Math.min(
    Math.floor(sampleRate / MIN_PITCH_HZ),
    frame.length - 2,
  );
  if (maxLag <= minLag) {
    return null;
  }

  const difference = new Float64Array(maxLag + 1);
  const normalizedDifference = new Float64Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag += 1) {
    let sum = 0;
    const comparisonLength = frame.length - lag;
    for (let index = 0; index < comparisonLength; index += 1) {
      const delta = frame[index]! - frame[index + lag]!;
      sum += delta * delta;
    }
    difference[lag] = sum;
  }

  let cumulativeDifference = 0;
  for (let lag = 1; lag <= maxLag; lag += 1) {
    cumulativeDifference += difference[lag]!;
    normalizedDifference[lag] =
      cumulativeDifference === 0
        ? 1
        : (difference[lag]! * lag) / cumulativeDifference;
  }

  let selectedLag = -1;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    if (normalizedDifference[lag]! < YIN_THRESHOLD) {
      while (
        lag < maxLag &&
        normalizedDifference[lag + 1]! < normalizedDifference[lag]!
      ) {
        lag += 1;
      }
      selectedLag = lag;
      break;
    }
  }

  if (selectedLag < 0) {
    let bestLag = minLag;
    for (let lag = minLag + 1; lag <= maxLag; lag += 1) {
      if (normalizedDifference[lag]! < normalizedDifference[bestLag]!) {
        bestLag = lag;
      }
    }
    if (normalizedDifference[bestLag]! >= 0.25) {
      return null;
    }
    selectedLag = bestLag;
  }

  const confidence = 1 - normalizedDifference[selectedLag]!;
  if (confidence < MIN_YIN_CONFIDENCE) {
    return null;
  }

  const left = normalizedDifference[selectedLag - 1] ?? 1;
  const center = normalizedDifference[selectedLag]!;
  const right = normalizedDifference[selectedLag + 1] ?? 1;
  const denominator = left - 2 * center + right;
  const offset =
    Math.abs(denominator) < Number.EPSILON
      ? 0
      : Math.max(
          -1,
          Math.min(1, 0.5 * ((left - right) / denominator)),
        );
  const pitch = sampleRate / (selectedLag + offset);
  return pitch >= MIN_PITCH_HZ && pitch <= MAX_PITCH_HZ ? pitch : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function percentile(values: number[], proportion: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * proportion;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const weight = index - lowerIndex;
  return (
    sorted[lowerIndex]! * (1 - weight) +
    sorted[upperIndex]! * weight
  );
}

function unavailable(status: PitchAnalysisStatus): PitchAnalysis {
  return {
    medianPitchHz: null,
    variationSemitones: null,
    voicedFrameCount: 0,
    status,
  };
}

export function analyzeWavPitch(buffer: Buffer): PitchAnalysis {
  const wav = parsePcmWav(buffer);
  if (!wav) {
    return unavailable("UNSUPPORTED_FORMAT");
  }

  const { samples, sampleRate } = downsampleToMono(buffer, wav);
  const frameLength = Math.floor(sampleRate * FRAME_DURATION_SECONDS);
  const hopLength = Math.floor(sampleRate * FRAME_HOP_SECONDS);
  if (frameLength < 32 || samples.length < frameLength) {
    return unavailable("INSUFFICIENT_VOICED_FRAMES");
  }

  const minLag = Math.floor(sampleRate / MAX_PITCH_HZ);
  const maxLag = Math.floor(sampleRate / MIN_PITCH_HZ);
  const frame = new Float64Array(frameLength);
  const pitches: number[] = [];

  for (
    let start = 0;
    start + frameLength <= samples.length;
    start += hopLength
  ) {
    let mean = 0;
    let clippedSamples = 0;
    for (let index = 0; index < frameLength; index += 1) {
      const sample = samples[start + index]!;
      mean += sample;
      if (Math.abs(sample) >= 0.98) {
        clippedSamples += 1;
      }
    }
    mean /= frameLength;
    let energy = 0;
    for (let index = 0; index < frameLength; index += 1) {
      const centered = samples[start + index]! - mean;
      frame[index] = centered;
      energy += centered * centered;
    }
    const rms = Math.sqrt(energy / frameLength);
    if (
      rms < MIN_VOICED_RMS ||
      clippedSamples / frameLength > MAX_CLIPPED_SAMPLE_RATIO ||
      maxLag >= frameLength - 2 ||
      minLag < 2
    ) {
      continue;
    }
    const pitch = interpolatePitch(frame, sampleRate);
    if (pitch !== null) {
      pitches.push(pitch);
    }
  }

  if (pitches.length < MIN_VOICED_FRAMES) {
    return unavailable("INSUFFICIENT_VOICED_FRAMES");
  }

  const semitoneValues = pitches.map((pitch) => 12 * Math.log2(pitch));
  const variationSemitones =
    percentile(semitoneValues, 0.75) - percentile(semitoneValues, 0.25);
  return {
    medianPitchHz: Math.round(median(pitches) * 10) / 10,
    variationSemitones: Math.round(variationSemitones * 10) / 10,
    voicedFrameCount: pitches.length,
    status: "MEASURED",
  };
}
