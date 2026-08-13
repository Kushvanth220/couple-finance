export type AiProviderId = "gemini" | "chatgpt" | "grok";

export interface AiProviderStatus {
  id: AiProviderId;
  label: string;
  configured: boolean;
}

export function getAiProviderStatus(): AiProviderStatus[] {
  return [
    {
      id: "gemini",
      label: "Gemini",
      configured: Boolean(process.env.GEMINI_API_KEY),
    },
    {
      id: "chatgpt",
      label: "ChatGPT",
      configured: Boolean(process.env.OPENAI_API_KEY),
    },
    {
      id: "grok",
      label: "Grok",
      configured: Boolean(process.env.XAI_API_KEY),
    },
  ];
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function openaiCompatibleChat(options: {
  url: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  label: string;
}): Promise<string> {
  const response = await withTimeout(
    fetch(options.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        temperature: 0.4,
        max_tokens: 320,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.user },
        ],
      }),
    }),
    8000,
    options.label
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${options.label} failed (${response.status}): ${detail.slice(0, 180)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`${options.label} returned an empty reply.`);
  return text;
}

export async function generateChatGptReply(system: string, user: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  return openaiCompatibleChat({
    url: "https://api.openai.com/v1/chat/completions",
    apiKey,
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    system,
    user,
    label: "ChatGPT",
  });
}

export async function generateGrokReply(system: string, user: string): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("XAI_API_KEY is not configured.");
  return openaiCompatibleChat({
    url: "https://api.x.ai/v1/chat/completions",
    apiKey,
    model: process.env.XAI_MODEL ?? "grok-3-mini",
    system,
    user,
    label: "Grok",
  });
}
