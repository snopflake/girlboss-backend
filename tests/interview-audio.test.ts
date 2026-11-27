import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSpeechDeliveryMetrics,
  type InterviewTranscription,
} from "../src/services/interview-audio.js";
import { analyzeWavPitch } from "../src/services/wav-pitch-analyzer.js";
import { speechDeliveryMetricsSchema } from "../src/validators/interview-sessions.validator.js";

function createPcmWav(
  sample: (timeSeconds: number) => number,
  durationSeconds = 1,
  sampleRate = 16_000,
): Buffer {
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const amplitude = Math.max(-1, Math.min(1, sample(time)));
    buffer.writeInt16LE(Math.round(amplitude * 32_767), 44 + index * 2);
  }
  return buffer;
}

test("WAV pitch analysis measures a synthetic voiced tone and its pitch variation", () => {
  const constantPitch = analyzeWavPitch(
    createPcmWav((time) => 0.5 * Math.sin(2 * Math.PI * 200 * time)),
  );
  assert.equal(constantPitch.status, "MEASURED");
  assert.ok(
    constantPitch.medianPitchHz !== null &&
      Math.abs(constantPitch.medianPitchHz - 200) < 8,
  );
  assert.ok(
    constantPitch.variationSemitones !== null &&
      constantPitch.variationSemitones < 1,
  );
  assert.ok(constantPitch.voicedFrameCount >= 10);
  const responseMetrics = buildSpeechDeliveryMetrics(
    {
      text: "A measured answer with enough words to estimate its rate.",
      durationSeconds: 1,
      segments: null,
    },
    constantPitch,
  );
  assert.equal(responseMetrics.pitchStatus, "MEASURED");
  assert.equal(responseMetrics.pitchMedianHz, constantPitch.medianPitchHz);
  assert.equal(
    speechDeliveryMetricsSchema.safeParse(responseMetrics).success,
    true,
  );

  let phase = 0;
  const varyingPitch = analyzeWavPitch(
    createPcmWav((time) => {
      const frequency = 130 + 130 * time;
      phase += (2 * Math.PI * frequency) / 16_000;
      return 0.5 * Math.sin(phase);
    }),
  );
  assert.equal(varyingPitch.status, "MEASURED");
  assert.ok(
    varyingPitch.variationSemitones !== null &&
      varyingPitch.variationSemitones > 3,
  );
});

test("silence and unsupported WAV encoding do not produce pitch values", () => {
  const silence = analyzeWavPitch(createPcmWav(() => 0));
  assert.equal(silence.status, "INSUFFICIENT_VOICED_FRAMES");
  assert.equal(silence.medianPitchHz, null);
  assert.equal(silence.variationSemitones, null);
  assert.equal(silence.voicedFrameCount, 0);

  const unsupported = createPcmWav((time) =>
    0.5 * Math.sin(2 * Math.PI * 200 * time),
  );
  unsupported.writeUInt16LE(6, 20);
  const invalidEncoding = analyzeWavPitch(unsupported);
  assert.equal(invalidEncoding.status, "UNSUPPORTED_FORMAT");
  assert.equal(invalidEncoding.medianPitchHz, null);
  assert.equal(invalidEncoding.variationSemitones, null);
});

test("pause metric is explicitly identified as a Whisper segment-gap estimate", () => {
  const transcription: InterviewTranscription = {
    text: "Saya menjelaskan hasil dan dampaknya.",
    durationSeconds: 4,
    segments: [
      { start: 0, end: 1, text: "Saya menjelaskan" },
      { start: 2, end: 3, text: "hasil dan dampaknya" },
    ],
  };
  const metrics = buildSpeechDeliveryMetrics(transcription);
  assert.equal(speechDeliveryMetricsSchema.safeParse(metrics).success, true);
  assert.equal(metrics.pauseCount, 1);
  assert.equal(metrics.pauseStatus, "ESTIMATED_FROM_SEGMENTS");
  assert.equal(metrics.pauseSource, "WHISPER_SEGMENT_TIMESTAMPS");
  assert.match(metrics.deliveryFeedback, /bukan deteksi hening akustik/);
});
