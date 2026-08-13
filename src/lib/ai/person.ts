import type { Person } from "@/types";
import { PERSON_LABELS } from "@/types";

export const AI_USER_IDS = ["kushvanth", "grishma"] as const;
export type AiUserId = Person;

const USER_ALIASES: Record<string, AiUserId> = {
  kushvanth: "kushvanth",
  kushwanth: "kushvanth",
  kush: "kushvanth",
  guzman: "kushvanth",
  grishma: "grishma",
  greeshma: "grishma",
  grish: "grishma",
  krishna: "grishma",
  griezmann: "grishma",
  grizzma: "grishma",
};

const NAME_PATTERN =
  "kushvanth|kushwanth|kush|guzman|grishma|greeshma|grish|krishna|griezmann|grizzma";

export function parseAiUserId(value: unknown): AiUserId | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return USER_ALIASES[normalized] ?? null;
}

export function assertAiUserId(value: unknown): AiUserId {
  const parsed = parseAiUserId(value);
  if (!parsed) {
    throw new Error('Invalid user_id. Use "kushvanth" or "grishma".');
  }
  return parsed;
}

export function getAiUserDisplayName(userId: AiUserId): string {
  return PERSON_LABELS[userId];
}

export const SPEAKER_CHIPS = [
  { id: "kushvanth" as const, label: PERSON_LABELS.kushvanth },
  { id: "grishma" as const, label: PERSON_LABELS.grishma },
];

/** Who is speaking — not "paid by X" on an expense. */
export function inferSpeakerFromUtterance(
  text: string,
  options?: { awaitingIdentity?: boolean }
): Person | null {
  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;

  const direct = parseAiUserId(normalized);
  if (direct) return direct;

  const identity = normalized.match(
    new RegExp(
      `\\b(?:it'?s|this is|i am|i'?m|im|my name is)\\s+(${NAME_PATTERN})\\b`
    )
  );
  if (identity) return parseAiUserId(identity[1]);

  if (/\bpaid\s+by\b/.test(normalized)) {
    return null;
  }

  const named = normalized.match(new RegExp(`\\b(${NAME_PATTERN})\\b`));
  if (!named) return null;

  const words = normalized.split(" ");
  const moneyTalk = /\b(spent|spend|paid|pay|gas|dollar|dollars|expense|account)\b/.test(
    normalized
  );
  if (options?.awaitingIdentity) {
    if (moneyTalk) return null;
    return parseAiUserId(named[1]);
  }

  if (words.length <= 8 && !moneyTalk) {
    return parseAiUserId(named[1]);
  }
  return null;
}

export function speakingWithInstruction(speaker?: Person | null): string {
  if (!speaker) {
    return `WHO IS SPEAKING (do this first):
- You do not know who is talking until they say Kushvanth or Grishma.
- First question: "Who am I talking to — Kushvanth or Grishma?"
- Do not record money until you know. If they already described an expense, remember it, then ask who is speaking.
- Never assume it is Kushvanth.`;
  }

  const name = getAiUserDisplayName(speaker);
  return `WHO IS SPEAKING:
- You are talking to ${name} (${speaker}).
- "I", "me", and "I spent" mean ${name}. Record that person's money unless they say it is for both or someone else paid.
- Default paid_by and personal expense_for to ${speaker}. "We spent" / split = expense_for both, paid_by ${speaker}, unless they name the other person.`;
}

export function askWhoIsSpeakingPrompt(): string {
  return `The user just woke you. Say only: "Hey — who am I talking to, Kushvanth or Grishma?" Do not call tools. Do not list questions. Do not greet twice. Do not record money until they answer.`;
}

export function speakingWithConfirmedPrompt(speaker: Person): string {
  const name = getAiUserDisplayName(speaker);
  return `App result (do not call tools): ${JSON.stringify({
    ok: true,
    speaking_with: speaker,
  })}. You are talking to ${name}. When they say I or me, that is ${name}. Record money as ${name}'s unless they say it is for both or someone else paid. Say: "Got it, ${name}." Then ask about expenses in one short English sentence.`;
}
