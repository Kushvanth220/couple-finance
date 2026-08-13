const LIVE_INPUT_SAMPLE_RATE = 16000;
const LIVE_OUTPUT_SAMPLE_RATE = 24000;

let audioUnlockPromise: Promise<void> | null = null;

/** Browsers block audio until a user gesture — call before voice playback. */
export async function ensureAudioUnlocked(): Promise<void> {
  if (typeof window === "undefined") return;

  if (!audioUnlockPromise) {
    audioUnlockPromise = (async () => {
      const context = new AudioContext();
      try {
        if (context.state === "suspended") {
          await context.resume();
        }
        const buffer = context.createBuffer(1, 1, 22050);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.start(0);
      } finally {
        await context.close();
      }
    })();
  }

  await audioUnlockPromise;
}

export function arrayBufferToBase64(buffer: ArrayBufferLike): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function downsampleBuffer(
  buffer: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number
): Float32Array {
  if (outputSampleRate === inputSampleRate) return buffer;
  if (outputSampleRate > inputSampleRate) return buffer;

  const ratio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < buffer.length; j += 1) {
      sum += buffer[j]!;
      count += 1;
    }
    result[i] = count > 0 ? sum / count : 0;
  }

  return result;
}

export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]!));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

export function int16ToFloat32(input: Int16Array): Float32Array {
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    output[i] = input[i]! / (input[i]! < 0 ? 0x8000 : 0x7fff);
  }
  return output;
}

export interface MicStreamer {
  stop: () => void;
}

function computeRmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i]!;
    sum += sample * sample;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 10);
}

export async function startMicStreamer(
  onChunk: (base64Pcm: string) => void,
  onLevel?: (level: number) => void
): Promise<MicStreamer> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone is not supported in this browser.");
  }

  await ensureAudioUnlocked();

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  const audioContext = new AudioContext();
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const gain = audioContext.createGain();
  gain.gain.value = 0;

  processor.onaudioprocess = (event) => {
    const channel = event.inputBuffer.getChannelData(0);
    onLevel?.(computeRmsLevel(channel));
    const downsampled = downsampleBuffer(
      channel,
      audioContext.sampleRate,
      LIVE_INPUT_SAMPLE_RATE
    );
    const pcm = floatTo16BitPCM(downsampled);
    onChunk(arrayBufferToBase64(pcm.buffer));
  };

  source.connect(processor);
  processor.connect(gain);
  gain.connect(audioContext.destination);

  return {
    stop: () => {
      processor.disconnect();
      source.disconnect();
      gain.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void audioContext.close();
    },
  };
}

export class LiveAudioPlayer {
  private audioContext: AudioContext;
  private pending: Float32Array[] = [];
  private pendingSamples = 0;
  private nextStartTime = 0;
  private sources: AudioBufferSourceNode[] = [];
  private closed = false;
  private scheduling = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private levelDecayTimer: ReturnType<typeof setTimeout> | null = null;
  private onLevel?: (level: number) => void;
  /** ~200ms at 24kHz — batches tiny chunks to prevent stutter. */
  private readonly minBatchSamples = 4800;

  constructor(options?: { onLevel?: (level: number) => void }) {
    this.onLevel = options?.onLevel;
    this.audioContext = new AudioContext({ sampleRate: LIVE_OUTPUT_SAMPLE_RATE });
  }

  enqueueBase64Pcm(base64: string) {
    if (this.closed) return;
    const buffer = base64ToArrayBuffer(base64);
    const pcm = new Int16Array(buffer);
    this.pending.push(int16ToFloat32(pcm));
    this.pendingSamples += pcm.length;
    this.queueSchedule();
  }

  private queueSchedule() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.pendingSamples >= this.minBatchSamples) {
      void this.schedule();
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.schedule();
    }, 70);
  }

  private takeBatch(): Float32Array | null {
    if (this.pendingSamples === 0) return null;

    const merged = new Float32Array(this.pendingSamples);
    let offset = 0;
    for (const chunk of this.pending) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.pending = [];
    this.pendingSamples = 0;
    return merged;
  }

  private async schedule() {
    if (this.scheduling || this.closed || this.pendingSamples === 0) return;
    this.scheduling = true;

    try {
      await ensureAudioUnlocked();
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      const samples = this.takeBatch();
      if (!samples || samples.length === 0) return;

      this.onLevel?.(computeRmsLevel(samples));
      if (this.levelDecayTimer) clearTimeout(this.levelDecayTimer);
      this.levelDecayTimer = setTimeout(() => {
        this.onLevel?.(0);
      }, 180);

      const audioBuffer = this.audioContext.createBuffer(
        1,
        samples.length,
        LIVE_OUTPUT_SAMPLE_RATE
      );
      audioBuffer.copyToChannel(new Float32Array(samples), 0);

      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);
      source.onended = () => {
        this.sources = this.sources.filter((item) => item !== source);
      };
      this.sources.push(source);

      const startAt = Math.max(this.audioContext.currentTime + 0.02, this.nextStartTime);
      source.start(startAt);
      this.nextStartTime = startAt + audioBuffer.duration;
    } finally {
      this.scheduling = false;
      if (this.pendingSamples > 0 && !this.closed) {
        this.queueSchedule();
      }
    }
  }

  get isSpeaking() {
    if (this.closed) return false;
    if (this.pendingSamples > 0 || this.sources.length > 0) return true;
    return this.nextStartTime > this.audioContext.currentTime + 0.05;
  }

  /** Drop queued and playing audio so a new reply cannot overlap the last one. */
  interrupt() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.levelDecayTimer) {
      clearTimeout(this.levelDecayTimer);
      this.levelDecayTimer = null;
    }
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.sources = [];
    this.pending = [];
    this.pendingSamples = 0;
    this.nextStartTime = 0;
    this.onLevel?.(0);
  }

  stop() {
    this.closed = true;
    this.interrupt();
    void this.audioContext.close();
  }
}

export { LIVE_INPUT_SAMPLE_RATE, LIVE_OUTPUT_SAMPLE_RATE };
