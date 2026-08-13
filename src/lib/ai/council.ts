import {
  continueGeminiWithToolResults,
  generateGeminiPlainReply,
  generateGeminiReply,
  type GeminiChatOutcome,
  type GeminiChatTurn,
  type GeminiToolResponseInput,
} from "@/lib/ai/gemini-client";
import {
  generateChatGptReply,
  generateGrokReply,
  getAiProviderStatus,
  type AiProviderId,
} from "@/lib/ai/providers";
import { ASSISTANT_WRITE_TOOLS, spokenSaveConfirmation } from "@/lib/ai/assistant-confirmation";
import type { AssistantToolCall } from "@/lib/ai/tools";
import { buildHouseholdSystemInstruction } from "@/lib/ai/system-instructions";
import { inferAssistantToolCall } from "@/lib/ai/infer-write-intent";
import type { AiUserId } from "@/lib/ai/person";
import type { Part } from "@google/generative-ai";

export type CouncilChatOutcome = GeminiChatOutcome & {
  providers: AiProviderId[];
};

interface CouncilRequest {
  userId: AiUserId;
  financeContext: string;
  assistantName?: string;
  behaviorInstructions?: string[];
  reminders?: string[];
  speakingWith?: AiUserId | null;
  history: GeminiChatTurn[];
  message: string;
}

interface HiddenCandidate {
  id: AiProviderId;
  text: string;
}

const HIDDEN_LAYER_RULES = `You are one hidden layer in a 3-model network (Gemini, ChatGPT, Grok). All three are equals.
Answer the user's household-finance question yourself. Do not wait for another model.
English only. Short. Warm. One question at a time.
Never invent balances or transactions — use the finance snapshot.
NEVER say you updated, adjusted, saved, or recorded money unless this turn includes a tool result with saved true.
If they want to change Green Dot or any account balance and already gave the number, call the tool — do not only talk.
If they say yes after a balance/expense preview, call the write tool with user_confirmed true. Do not say "updating now."
If they ask to remember/remind something, call save_reminder. Do not talk about account balances.
Never mention Gemini, ChatGPT, Grok, OpenAI, xAI, or that you are a hidden layer.`;

const OUTPUT_LAYER_RULES = `You are the output layer of a 3-model network.
Three hidden layers answered independently. Produce ONE best English reply for the user.
Keep correct numbers. Drop guesses that conflict with the finance snapshot.
NEVER claim a balance/expense/income was saved unless a hidden layer cites a tool result with saved true.
If any hidden layer pretended a save happened, discard that and ask for the missing number or a yes instead.
One or two short sentences, then at most one question.
Never mention the models or that this was a vote.`;

function isUsableReply(text: string | null | undefined): text is string {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 800) return false;
  if (/as an ai|language model|chatgpt|openai|grok|gemini|hidden layer/i.test(trimmed)) {
    return false;
  }
  return true;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9$]+/g, " ")
      .split(" ")
      .filter((word) => word.length > 2)
  );
}

function overlap(a: string, b: string): number {
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.size === 0 || right.size === 0) return 0;
  let hits = 0;
  for (const word of left) {
    if (right.has(word)) hits += 1;
  }
  return hits / Math.min(left.size, right.size);
}

function pickBestCandidate(candidates: HiddenCandidate[]): HiddenCandidate {
  if (candidates.length === 1) return candidates[0]!;

  let best = candidates[0]!;
  let bestScore = -1;

  for (const candidate of candidates) {
    const agreement = candidates
      .filter((other) => other.id !== candidate.id)
      .reduce((sum, other) => sum + overlap(candidate.text, other.text), 0);
    const lengthScore = candidate.text.length >= 24 && candidate.text.length <= 420 ? 0.15 : 0;
    const score = agreement + lengthScore;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function hiddenUserPayload(options: CouncilRequest, extra?: string): string {
  const historyBlock = options.history
    .slice(-8)
    .map((turn) => `${turn.role}: ${turn.content}`)
    .join("\n");
  return [
    extra,
    historyBlock,
    options.speakingWith ? `You are talking to ${options.speakingWith}.` : "You do not know who is speaking yet. Ask first.",
    `user: ${options.message}`,
    "Answer as the household AI.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function runHiddenLayers(
  options: CouncilRequest,
  extra?: string,
  skipGemini = false
): Promise<{ gemini: GeminiChatOutcome | null; candidates: HiddenCandidate[] }> {
  const status = getAiProviderStatus();
  const system = [
    buildHouseholdSystemInstruction(options.financeContext, {
      assistantName: options.assistantName,
      behaviorInstructions: options.behaviorInstructions,
      reminders: options.reminders,
      speakingWith: options.speakingWith,
    }),
    HIDDEN_LAYER_RULES,
  ].join("\n\n");
  const user = hiddenUserPayload(options, extra);
  const geminiOn = !skipGemini && status.find((item) => item.id === "gemini")?.configured;
  const chatgptOn = status.find((item) => item.id === "chatgpt")?.configured;
  const grokOn = status.find((item) => item.id === "grok")?.configured;

  const [geminiResult, chatgptResult, grokResult] = await Promise.allSettled([
    geminiOn
      ? extra
        ? generateGeminiPlainReply(system, user).then(
            (reply) => ({ kind: "reply" as const, reply }) satisfies GeminiChatOutcome
          )
        : generateGeminiReply(options)
      : Promise.reject(new Error("Gemini is not configured.")),
    chatgptOn
      ? withTimeout(generateChatGptReply(system, user), 2800)
      : Promise.reject(new Error("ChatGPT is off.")),
    grokOn
      ? withTimeout(generateGrokReply(system, user), 2800)
      : Promise.reject(new Error("Grok is off.")),
  ]);

  const candidates: HiddenCandidate[] = [];
  let gemini: GeminiChatOutcome | null = null;

  if (geminiResult.status === "fulfilled") {
    gemini = geminiResult.value;
    if (gemini.kind === "reply" && isUsableReply(gemini.reply)) {
      candidates.push({ id: "gemini", text: gemini.reply });
    }
  }

  if (chatgptResult.status === "fulfilled" && isUsableReply(chatgptResult.value)) {
    candidates.push({ id: "chatgpt", text: chatgptResult.value });
  }

  if (grokResult.status === "fulfilled" && isUsableReply(grokResult.value)) {
    candidates.push({ id: "grok", text: grokResult.value });
  }

  return { gemini, candidates };
}

const HONEST_SAVE_PROMPT =
  "Nothing was saved yet. Tell me the new amount and which account. I'll read it back, then say yes so I can save it on Accounts and History.";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out")), ms);
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

function claimsMoneyWasSaved(text: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  return (
    /\b(i('ve| have)? (just )?(updated|adjusted|saved|recorded|changed|set))\b/.test(t) ||
    /\b(updated|adjusted|saved|recorded)\b.{0,50}\b(balance|green\s*dot|account|expense|income)\b/.test(t) ||
    /\b(the )?(expense|expenses|income|balance) (is|are|was|were) (now )?(recorded|updated|saved)\b/.test(t) ||
    /\byes[,.]? (the )?(expense|expenses) (is|are) recorded\b/.test(t) ||
    /\bbalance (is|was|has been) (now )?(updated|adjusted|set|saved)\b/.test(t) ||
    /\bgot it[.!,]?\s+i('ll| will) (update|adjust|save|record)\b/.test(t) ||
    /\bi('ll| will) update (the )?(green\s*dot|balance|account)\b/.test(t) ||
    /\b(updating|saving|recording) now\b/.test(t)
  );
}

function spokenReplyForSavedTools(responses: GeminiToolResponseInput[]): string {
  const saved = responses.find((item) => {
    const result = item.result as Record<string, unknown> | undefined;
    return result?.saved === true;
  });
  if (!saved) return "Got it.";
  return spokenSaveConfirmation({
    id: saved.id,
    name: saved.name,
    args: {},
  } as AssistantToolCall);
}

function looksLikeReminder(message: string): boolean {
  return /\b(remember|reminder|remind me|don't forget|dont forget)\b/i.test(message);
}

function looksLikeMoneyWrite(message: string): boolean {
  const t = message.toLowerCase();
  if (looksLikeReminder(t)) return false;
  return (
    /\b(update|adjust|set|change)\b.{0,48}\b(balance|green\s*dot|account)\b/.test(t) ||
    /\b(record|log|deposit|income|expense|spent|paid)\b/.test(t) ||
    /\b(add|pay)\b.{0,24}\bdebt\b/.test(t) ||
    /\bgreen\s*dot\b/.test(t)
  );
}

function isAffirmation(message: string): boolean {
  return /^(yes|yeah|yep|yup|ok|okay|correct|that's right|thats right|save it|do it|confirm)\b/i.test(
    message.trim()
  );
}

function shouldBlockFakeMoneySave(options: { message: string; history: { content: string }[] }): boolean {
  if (looksLikeReminder(options.message)) return false;
  if (looksLikeMoneyWrite(options.message) || isAffirmation(options.message)) return true;
  return options.history.slice(-4).some((turn) => looksLikeMoneyWrite(turn.content));
}

function honestCandidates(
  candidates: HiddenCandidate[],
  fallback: string
): HiddenCandidate[] {
  const honest = candidates.filter((item) => !claimsMoneyWasSaved(item.text));
  if (honest.length > 0) return honest;
  return [{ id: "gemini", text: fallback }];
}

function toolResultsSaved(responses: GeminiToolResponseInput[]): boolean {
  return responses.some((item) => {
    const result = item.result as Record<string, unknown> | undefined;
    if (!result) return false;
    if (result.saved === true) return true;
    return ASSISTANT_WRITE_TOOLS.has(item.name) && result.ok === true;
  });
}

async function outputLayer(
  options: CouncilRequest,
  candidates: HiddenCandidate[]
): Promise<{ reply: string; providers: AiProviderId[] }> {
  const providers = candidates.map((item) => item.id);
  if (candidates.length === 0) {
    throw new Error("All hidden layers failed.");
  }
  if (candidates.length === 1) {
    return { reply: candidates[0]!.text, providers };
  }

  const consensus = candidates.every(
    (item) => overlap(item.text, candidates[0]!.text) >= 0.5
  );
  if (consensus) {
    return { reply: pickBestCandidate(candidates).text, providers };
  }

  const snapshot = options.financeContext.slice(0, 2500);
  const synthesisUser = `User asked: ${options.message}

Finance snapshot:
${snapshot}

Hidden layer Gemini: ${candidates.find((item) => item.id === "gemini")?.text ?? "(no reply)"}
Hidden layer ChatGPT: ${candidates.find((item) => item.id === "chatgpt")?.text ?? "(no reply)"}
Hidden layer Grok: ${candidates.find((item) => item.id === "grok")?.text ?? "(no reply)"}

Return only the single best reply.`;

  const status = getAiProviderStatus();
  const [geminiOut, chatgptOut, grokOut] = await Promise.allSettled([
    status.find((item) => item.id === "gemini")?.configured
      ? generateGeminiPlainReply(OUTPUT_LAYER_RULES, synthesisUser)
      : Promise.reject(new Error("Gemini is off.")),
    status.find((item) => item.id === "chatgpt")?.configured
      ? withTimeout(generateChatGptReply(OUTPUT_LAYER_RULES, synthesisUser), 2800)
      : Promise.reject(new Error("ChatGPT is off.")),
    status.find((item) => item.id === "grok")?.configured
      ? withTimeout(generateGrokReply(OUTPUT_LAYER_RULES, synthesisUser), 2800)
      : Promise.reject(new Error("Grok is off.")),
  ]);

  const synthesized: HiddenCandidate[] = [];
  if (geminiOut.status === "fulfilled" && isUsableReply(geminiOut.value)) {
    synthesized.push({ id: "gemini", text: geminiOut.value });
  }
  if (chatgptOut.status === "fulfilled" && isUsableReply(chatgptOut.value)) {
    synthesized.push({ id: "chatgpt", text: chatgptOut.value });
  }
  if (grokOut.status === "fulfilled" && isUsableReply(grokOut.value)) {
    synthesized.push({ id: "grok", text: grokOut.value });
  }

  const chosen = pickBestCandidate(synthesized.length > 0 ? synthesized : candidates);
  return { reply: chosen.text, providers };
}

export async function generateCouncilReply(options: CouncilRequest): Promise<CouncilChatOutcome> {
  const { gemini, candidates } = await runHiddenLayers(options);

  if (gemini?.kind === "tool_calls") {
    return { ...gemini, providers: ["gemini", ...candidates.map((item) => item.id).filter((id) => id !== "gemini")] };
  }

  const inferred = inferAssistantToolCall(options.message, options.history, options.speakingWith);
  if (inferred) {
    return {
      kind: "tool_calls",
      toolCalls: [inferred.call],
      modelParts: inferred.modelParts as never,
      providers: ["gemini", ...candidates.map((item) => item.id)],
    };
  }

  if (candidates.length === 0) {
    throw new Error("Gemini, ChatGPT, and Grok all failed to answer.");
  }

  const blockFake = shouldBlockFakeMoneySave(options);
  const output = await outputLayer(
    options,
    blockFake ? honestCandidates(candidates, HONEST_SAVE_PROMPT) : candidates
  );
  const reply =
    blockFake && claimsMoneyWasSaved(output.reply) ? HONEST_SAVE_PROMPT : output.reply;
  return { kind: "reply", reply, providers: output.providers };
}

function waitingOnUserReply(responses: GeminiToolResponseInput[]): string | null {
  for (const item of responses) {
    const result = item.result as Record<string, unknown> | undefined;
    if (!result) continue;
    if (result.status === "needs_confirmation") {
      const preview = typeof result.preview === "string" ? result.preview : "";
      return preview
        ? `${preview} Tap Yes, save when that looks right.`
        : "Tap Yes, save when that looks right.";
    }
    if (result.needs_cash_source === true) {
      return String(result.error ?? "Cash wallet is low — which account did the cash come from?");
    }
    if (result.needs_payer === true) {
      return String(result.error ?? "Who paid — Kushvanth, Grishma, or both?");
    }
    if (result.needs_speaker === true) {
      return String(result.error ?? "Who am I talking to — Kushvanth or Grishma?");
    }
    if (result.needs_account === true) {
      return String(result.error ?? "Which account should I use?");
    }
  }
  return null;
}

export async function continueCouncilWithToolResults(
  options: CouncilRequest & {
    userMessage: string;
    modelParts: Part[];
    toolResponses: GeminiToolResponseInput[];
  }
): Promise<CouncilChatOutcome> {
  if (toolResultsSaved(options.toolResponses)) {
    return {
      kind: "reply",
      reply: spokenReplyForSavedTools(options.toolResponses),
      providers: ["gemini"],
    };
  }

  const waitingReply = waitingOnUserReply(options.toolResponses);
  if (waitingReply) {
    return {
      kind: "reply",
      reply: waitingReply,
      providers: ["gemini"],
    };
  }

  const toolSummary = options.toolResponses
    .map((item) => `${item.name}: ${JSON.stringify(item.result)}`)
    .join("\n");

  const [geminiSettled, hidden] = await Promise.all([
    continueGeminiWithToolResults(options).then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const, value: null })
    ),
    runHiddenLayers(
      { ...options, message: options.userMessage },
      `App tools already ran. Results:\n${toolSummary}\nWrite the user-facing reply only. Do not call tools.`,
      true
    ),
  ]);

  const geminiResult = geminiSettled.ok ? geminiSettled.value : null;

  if (geminiResult?.kind === "tool_calls") {
    return { ...geminiResult, providers: ["gemini"] };
  }

  const candidates = hidden.candidates.filter((item) => item.id !== "gemini");
  if (geminiResult?.kind === "reply" && isUsableReply(geminiResult.reply)) {
    candidates.unshift({ id: "gemini", text: geminiResult.reply });
  }

  if (candidates.length === 0) {
    throw new Error("All hidden layers failed after tools.");
  }

  const saved = toolResultsSaved(options.toolResponses);
  const blockFake = !saved && shouldBlockFakeMoneySave({
    message: options.userMessage,
    history: options.history,
  });
  const output = await outputLayer(
    { ...options, message: options.userMessage },
    blockFake ? honestCandidates(candidates, HONEST_SAVE_PROMPT) : candidates
  );
  const reply =
    blockFake && claimsMoneyWasSaved(output.reply) ? HONEST_SAVE_PROMPT : output.reply;
  return { kind: "reply", reply, providers: output.providers };
}
