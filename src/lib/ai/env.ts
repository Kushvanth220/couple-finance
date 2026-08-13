function firstEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

/** Gemini / Google AI Studio */
export function readGeminiApiKey(): string {
  return firstEnv("GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY");
}

/** ChatGPT / OpenAI */
export function readOpenAiApiKey(): string {
  return firstEnv("OPENAI_API_KEY", "CHATGPT_API_KEY");
}

/** Grok / xAI */
export function readXaiApiKey(): string {
  return firstEnv("XAI_API_KEY", "GROK_API_KEY");
}
