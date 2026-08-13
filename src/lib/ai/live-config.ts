/** Current Live native-audio model, then older previews if Google rejects it. */
export const GEMINI_LIVE_MODEL_CANDIDATES = [
  "gemini-3.1-flash-live-preview",
  "gemini-2.5-flash-native-audio-preview-12-2025",
  "gemini-2.5-flash-native-audio-preview-09-2025",
] as const;

export const GEMINI_LIVE_MODEL =
  process.env.GEMINI_LIVE_MODEL ?? GEMINI_LIVE_MODEL_CANDIDATES[0];

export function liveModelFallbackList(preferred = GEMINI_LIVE_MODEL): string[] {
  return [...new Set([GEMINI_LIVE_MODEL_CANDIDATES[0], preferred, ...GEMINI_LIVE_MODEL_CANDIDATES])];
}

export const GEMINI_LIVE_API_VERSION = "v1alpha" as const;

export const GEMINI_LIVE_VOICE = process.env.GEMINI_LIVE_VOICE ?? "Aoede";

/** Hardcoded English locale for STT/TTS and model behavior. */
export const ASSISTANT_LANGUAGE = "en-US" as const;

export const ASSISTANT_LIVE_INPUT_MIME = "audio/pcm;rate=16000";

export const ASSISTANT_LIVE_OUTPUT_SAMPLE_RATE = 24000;

export const LIVE_VOICE_MAX_CONNECT_RETRIES = 3;

export const LIVE_VOICE_RETRY_BASE_MS = 800;

const BASE_VOICE_VOCABULARY = [
  "Green Dot",
  "GreenDot",
  "Green dog",
  "Costco",
  "Kushvanth",
  "Grishma",
  "Krishna",
  "Jarvis",
  "Salaar",
  "Doordash",
  "DoorDash",
  "T-Mobile",
  "account balance",
  "current balance",
  "groceries",
  "grocery",
];

export function buildLiveTranscriptionConfig(assistantName?: string) {
  const name = assistantName?.trim();
  const vocabulary = name && !BASE_VOICE_VOCABULARY.includes(name)
    ? [...BASE_VOICE_VOCABULARY, name]
    : BASE_VOICE_VOCABULARY;

  return {
    languageCodes: [ASSISTANT_LANGUAGE],
    customVocabulary: vocabulary,
  };
}
