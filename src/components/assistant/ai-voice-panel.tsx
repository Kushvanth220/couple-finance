"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Mic, MicOff, Trash2 } from "lucide-react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassCard } from "@/components/ui/glass-card";
import {
  AssistantLiveOrb,
  type AssistantLiveOrbState,
} from "@/components/assistant/assistant-live-orb";
import type { LiveVoiceConnection } from "@/lib/ai/gemini-live-client";
import {
  connectLiveVoiceWithRetry,
  executeLiveToolCallsSafely,
  fetchLiveTokenPayload,
} from "@/lib/ai/live-voice-session";
import {
  ensureAudioUnlocked,
  getCaptureAudioContext,
  getPlaybackAudioContext,
  LiveAudioPlayer,
  requestLiveMicStream,
  startMicStreamer,
  type MicStreamer,
} from "@/lib/ai/audio-utils";
import { executeAssistantTools } from "@/lib/ai/execute-assistant-tool";
import { buildToolConfirmationPreview, isWriteTool, spokenSaveConfirmation, EXPENSE_PERSON_CHIPS, EXPENSE_PAID_BY_CHIPS, withExpensePerson, withPaidBy, accountChoicePrompt, withPickedAccount, writeToolNeedsAccount, expenseWriteNeedsPayer, sortAccountChips } from "@/lib/ai/assistant-confirmation";
import {
  asksIfMoneyWasSaved,
  inferWriteFromRecentTalk,
  isShortAffirmation,
  looksLikeExpenseCorrection,
  mergePendingWrite,
  withInferredAccount,
  applySpeakerToWrite,
} from "@/lib/ai/infer-write-intent";
import type { AssistantToolCall } from "@/lib/ai/tools";
import { getClientFinancePayload } from "@/lib/ai/client-finance-context";
import { getBehaviorInstructionsForAssistant, getRemindersForAssistant } from "@/store/assistant-preferences-store";
import type { AssistantVoiceGender } from "@/lib/ai/assistant-voice";
import type { Person } from "@/types";
import { PERSON_LABELS } from "@/types";
import {
  askWhoIsSpeakingPrompt,
  inferSpeakerFromUtterance,
  speakingWithConfirmedPrompt,
  SPEAKER_CHIPS,
} from "@/lib/ai/person";
import {
  createLiveTranscriptSession,
  ENGLISH_ONLY_REPLY,
  type VoiceTranscriptLine,
} from "@/lib/ai/live-transcript";
import { formatChatWhen } from "@/lib/ai/chat-time";
import { useAssistant } from "@/components/assistant/assistant-context";
import { useFinanceStore } from "@/store/finance-store";

const HOUSEHOLD_CHAT_USER: Person = "kushvanth";
const BARGE_IN_LEVEL = 0.38;
const BARGE_IN_CHUNKS = 3;
const ECHO_HOLD_MS = 320;

type AccountChip = { id: string; name: string };

function householdAccountChips(): AccountChip[] {
  const seen = new Set<string>();
  const chips: AccountChip[] = [];
  for (const account of useFinanceStore.getState().accounts) {
    const key = account.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    chips.push({ id: account.id, name: account.name });
  }
  return sortAccountChips(chips).slice(0, 8);
}

function householdDebitChips(): AccountChip[] {
  const seen = new Set<string>();
  const chips: AccountChip[] = [];
  for (const account of useFinanceStore.getState().accounts) {
    if (account.type !== "debit") continue;
    const key = account.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    chips.push({ id: account.id, name: account.name });
  }
  return sortAccountChips(chips).slice(0, 8);
}

function chipsFromToolAccounts(accounts: unknown, debitOnly = false): AccountChip[] {
  if (!Array.isArray(accounts)) return debitOnly ? householdDebitChips() : householdAccountChips();
  const listed = accounts
    .filter((item): item is { id?: string; name?: string; type?: string } => !!item && typeof item === "object")
    .filter((item) => item.id && item.name && (!debitOnly || item.type === "debit"))
    .map((item) => ({ id: String(item.id), name: String(item.name) }));
  return sortAccountChips(listed.length > 0 ? listed : debitOnly ? householdDebitChips() : householdAccountChips()).slice(0, 8);
}

function householdCategoryChips(): AccountChip[] {
  return useFinanceStore
    .getState()
    .spendCategories.filter((category) => category.name.trim())
    .slice(0, 8)
    .map((category) => ({ id: category.id, name: category.name }));
}

const VOICE_STEPS = [
  "First say who you are — or tap Kushvanth / Grishma.",
  "Talk like a person — it asks one thing at a time.",
  "Say the amount, then the account (Green Dot, cash, Chime).",
  "Say yes — or tap Yes, save. It will tell you the expenses are recorded.",
] as const;

interface VoiceLine extends VoiceTranscriptLine {}

interface AiVoicePanelProps {
  assistantName?: string;
  voiceGender?: AssistantVoiceGender;
  autoStart?: boolean;
  onAutoStartHandled?: () => void;
  onLiveChange?: (busy: boolean) => void;
}

function resolveOrbState(options: {
  status: "idle" | "connecting" | "live" | "error";
  awaitingConfirmation: boolean;
  outputLevel: number;
  toolBusy: boolean;
}): AssistantLiveOrbState {
  if (options.status === "connecting") return "connecting";
  if (options.status !== "live") return "idle";
  if (options.awaitingConfirmation || options.toolBusy) return "thinking";
  if (options.outputLevel > 0.04) return "speaking";
  return "listening";
}

function orbCaption(
  state: AssistantLiveOrbState,
  assistantName: string,
  liveHint: string
): string {
  if (state === "connecting") return "Connecting…";
  if (state === "thinking") return "Working on that…";
  if (state === "speaking") return `${assistantName} is speaking`;
  if (state === "listening") return "Listening…";
  if (liveHint && liveHint !== "Tap Start voice to talk with your AI.") {
    return liveHint;
  }
  return `Tap Start voice to talk with ${assistantName}`;
}

export function AiVoicePanel({
  assistantName = "Jarvis",
  voiceGender = "female",
  autoStart = false,
  onAutoStartHandled,
  onLiveChange,
}: AiVoicePanelProps) {
  const { voiceStartSignal, registerVoiceStarter, clearAutoStart } = useAssistant();
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<VoiceLine[]>([]);
  const [liveHint, setLiveHint] = useState("Tap Start voice to talk with your AI.");
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [lastSavedBanner, setLastSavedBanner] = useState<string | null>(null);
  const [accountChoices, setAccountChoices] = useState<AccountChip[]>([]);
  const [accountChoiceKind, setAccountChoiceKind] = useState<"pay-from" | "cash-source">("pay-from");
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [toolBusy, setToolBusy] = useState(false);
  const [hasUsedVoice, setHasUsedVoice] = useState(false);
  const [speaker, setSpeaker] = useState<Person | null>(null);

  const connectionRef = useRef<LiveVoiceConnection | null>(null);
  const micRef = useRef<MicStreamer | null>(null);
  const playerRef = useRef<LiveAudioPlayer | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const startVoiceRef = useRef<(() => Promise<void>) | null>(null);
  const sessionLockRef = useRef(false);
  const startGenerationRef = useRef(0);
  const greetedRef = useRef(false);
  const handledVoiceSignalRef = useRef("");
  const pendingWriteRef = useRef<AssistantToolCall | null>(null);
  const chatSessionIdRef = useRef<string | null>(null);
  const persistLineRef = useRef<(line: VoiceLine) => void>(() => {});
  const confirmVoiceWriteRef = useRef<(text: string, options?: { immediate?: boolean }) => void>(
    () => {}
  );
  const saveTimerRef = useRef<number | null>(null);
  const recentlyAffirmedRef = useRef(false);
  const lastSavedRef = useRef<{ key: string; at: number } | null>(null);
  const lastPersistedRef = useRef("");
  const speakerRef = useRef<Person | null>(null);
  const transcriptSessionRef = useRef(
    createLiveTranscriptSession(setLines, (line) => {
      persistLineRef.current(line);
      if (line.role === "user") confirmVoiceWriteRef.current(line.text);
    })
  );

  function writeKey(call: AssistantToolCall) {
    return `${call.name}:${String(call.args.amount ?? call.args.new_balance ?? "")}:${String(call.args.account_name ?? "")}:${String(call.args.expense_for ?? "")}:${String(call.args.paid_by ?? "")}`;
  }

  useEffect(() => {
    persistLineRef.current = (line) => {
      if (!line.text.trim()) return;
      if (line.text === ENGLISH_ONLY_REPLY) return;
      const persistKey = `${line.role}:${line.text}`;
      if (lastPersistedRef.current === persistKey) return;
      lastPersistedRef.current = persistKey;
      const title = `Voice · ${new Date().toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })}`;
      void (async () => {
        try {
          const response = await fetch("/api/ai/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: HOUSEHOLD_CHAT_USER,
              session_id: chatSessionIdRef.current,
              title,
              role: line.role,
              content: line.text,
            }),
          });
          const payload = await response.json();
          if (payload.ok && payload.session_id) {
            chatSessionIdRef.current = payload.session_id as string;
          }
        } catch {
          // Keep the live call going even if history save fails.
        }
      })();
    };

    confirmVoiceWriteRef.current = (text, options) => {
      const identified = inferSpeakerFromUtterance(text, {
        awaitingIdentity: !speakerRef.current,
      });
      if (identified) {
        speakerRef.current = identified;
        setSpeaker(identified);
        if (pendingWriteRef.current) {
          pendingWriteRef.current = applySpeakerToWrite(
            pendingWriteRef.current,
            identified
          );
        }
        playerRef.current?.interrupt();
        connectionRef.current?.sendGreeting(speakingWithConfirmedPrompt(identified));
        setLiveHint(`Talking to ${PERSON_LABELS[identified]}`);
      }

      const speaker = speakerRef.current;
      const recentUser = transcriptSessionRef.current
        .getLines()
        .filter((line) => line.role === "user")
        .slice(-8)
        .map((line) => line.text);
      const recentModel = transcriptSessionRef.current
        .getLines()
        .filter((line) => line.role === "model")
        .slice(-3)
        .map((line) => line.text);
      const inferred = inferWriteFromRecentTalk(recentUser, recentModel, speaker);
      if (inferred && isWriteTool(inferred.name)) {
        pendingWriteRef.current = mergePendingWrite(pendingWriteRef.current, inferred);
      }
      const withAccount = withInferredAccount(pendingWriteRef.current, text);
      if (withAccount) {
        pendingWriteRef.current = withAccount;
      }
      const merged = pendingWriteRef.current
        ? applySpeakerToWrite(pendingWriteRef.current, speaker)
        : pendingWriteRef.current;
      if (merged) pendingWriteRef.current = merged;
      if (merged && isWriteTool(merged.name)) {
        if (expenseWriteNeedsPayer(merged)) {
          setPendingPreview(buildToolConfirmationPreview(merged));
          setAwaitingConfirmation(true);
          setLiveHint("Who paid — Kushvanth, Grishma, or both?");
        } else if (writeToolNeedsAccount(merged)) {
          setAccountChoiceKind("pay-from");
          setAccountChoices(householdAccountChips());
          setPendingPreview(buildToolConfirmationPreview(merged));
          setAwaitingConfirmation(false);
          setLiveHint("Which account should I use?");
        } else {
          setPendingPreview(buildToolConfirmationPreview(merged));
          setAwaitingConfirmation(true);
        }
      }

      if (looksLikeExpenseCorrection(text) && !identified) {
        if (saveTimerRef.current) {
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        recentlyAffirmedRef.current = false;
        const pending = pendingWriteRef.current;
        if (pending?.name === "record_expense") {
          setPendingPreview(buildToolConfirmationPreview(pending));
          setAwaitingConfirmation(true);
          setLiveHint(
            expenseWriteNeedsPayer(pending)
              ? "Who paid — Kushvanth, Grishma, or both?"
              : buildToolConfirmationPreview(pending)
          );
        }
        return;
      }

      const shouldSave = isShortAffirmation(text) || asksIfMoneyWasSaved(text);
      if (shouldSave) recentlyAffirmedRef.current = true;
      const accountAnswerCompletesSave =
        Boolean(withAccount && merged && !writeToolNeedsAccount(merged) && !expenseWriteNeedsPayer(merged)) &&
        recentlyAffirmedRef.current &&
        !shouldSave;
      const identityCompletesSave =
        Boolean(identified) &&
        recentlyAffirmedRef.current &&
        Boolean(pendingWriteRef.current);
      if (!shouldSave && !accountAnswerCompletesSave && !identityCompletesSave) return;

      const runSave = () => {
        const actor = speakerRef.current;
        if (!actor) {
          setLiveHint("Who am I talking to — Kushvanth or Grishma?");
          playerRef.current?.interrupt();
          connectionRef.current?.sendGreeting(
            `App result (do not call tools): ${JSON.stringify({
              ok: false,
              needs_speaker: true,
              saved: false,
            })}. Ask who you are talking to — Kushvanth or Grishma — in one short English sentence. Do not say it was recorded.`
          );
          return;
        }
        const pending = pendingWriteRef.current ?? inferred;
        const prepared = pending ? applySpeakerToWrite(pending, actor) : null;
        const call = prepared
          ? { ...prepared, args: { ...prepared.args, user_confirmed: true } }
          : null;
        if (!call || !isWriteTool(call.name)) {
          if (asksIfMoneyWasSaved(text)) {
            setLiveHint("Not saved yet — tell me the expense again.");
            playerRef.current?.interrupt();
            connectionRef.current?.sendGreeting(
              `App result (do not call tools): ${JSON.stringify({
                ok: false,
                saved: false,
              })}. Say: "It was not recorded." Then ask them to confirm the amount, who paid, and the account. Do not say it was recorded.`
            );
          }
          return;
        }
        if (expenseWriteNeedsPayer(call)) {
          setAwaitingConfirmation(true);
          setLiveHint("Who paid — Kushvanth, Grishma, or both?");
          playerRef.current?.interrupt();
          connectionRef.current?.sendGreeting(
            `App result (do not call tools): ${JSON.stringify({
              ok: false,
              needs_payer: true,
              saved: false,
            })}. Ask who paid — Kushvanth, Grishma, or both — in one short English sentence. Do not say it was recorded.`
          );
          return;
        }
        if (writeToolNeedsAccount(call)) {
          setLiveHint("Which account should I use?");
          setAccountChoiceKind("pay-from");
          setAccountChoices(householdAccountChips());
          playerRef.current?.interrupt();
          connectionRef.current?.sendGreeting(
            `App result (do not call tools): ${JSON.stringify({
              ok: false,
              needs_account: true,
              saved: false,
            })}. Ask which account in one short English sentence. Do not say it was recorded.`
          );
          return;
        }

        const key = writeKey(call);
        const last = lastSavedRef.current;
        if (last && last.key === key && Date.now() - last.at < 45000) {
          if (asksIfMoneyWasSaved(text)) {
            playerRef.current?.interrupt();
            connectionRef.current?.sendGreeting(
              `App result (do not call tools): ${JSON.stringify({
                ok: true,
                saved: true,
                already: true,
              })}. Say exactly: "${spokenSaveConfirmation(call)}" Then stop.`
            );
          }
          return;
        }

        pendingWriteRef.current = call;
        setToolBusy(true);
        const [result] = executeAssistantTools(actor, [call]);
        setToolBusy(false);

        const saved = result?.result?.saved === true;
        if (saved) {
          pendingWriteRef.current = null;
          recentlyAffirmedRef.current = false;
          setAwaitingConfirmation(false);
          setPendingPreview(null);
          setAccountChoices([]);
          lastSavedRef.current = { key, at: Date.now() };
          const spoken = spokenSaveConfirmation(call);
          setLastSavedBanner(spoken);
          setLiveHint(spoken);
          window.setTimeout(() => setLastSavedBanner(null), 8000);
        } else if (result?.result?.needs_payer === true) {
          setAwaitingConfirmation(true);
          setLiveHint("Who paid — Kushvanth, Grishma, or both?");
        } else if (result?.result?.needs_cash_source === true) {
          setAccountChoiceKind("cash-source");
          setAccountChoices(chipsFromToolAccounts(result.result.accounts, true));
          setAwaitingConfirmation(false);
          setLiveHint("Cash wallet is low — which account did the cash come from?");
        } else if (result?.result?.needs_account === true) {
          setAccountChoiceKind("pay-from");
          setAccountChoices(chipsFromToolAccounts(result.result.accounts));
          setAwaitingConfirmation(false);
          setLiveHint("Which account should I use?");
        } else {
          setLiveHint(String(result?.result?.error ?? "Need one more detail."));
        }

        playerRef.current?.interrupt();
        const summary = JSON.stringify(result?.result ?? { ok: false, saved: false });
        const spoken = saved ? spokenSaveConfirmation(call) : null;
        connectionRef.current?.sendGreeting(
          saved
            ? `App result (do not call tools): ${summary}. Say exactly: "${spoken}" Then stop. Do not ask a follow-up.`
            : `App result (do not call tools): ${summary}. Ask for the missing detail in one short English sentence. Do not say it was recorded.`
        );
      };

      if (options?.immediate) {
        runSave();
        return;
      }
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        runSave();
      }, 850);
    };
  }, []);

  const orbState = useMemo(
    () =>
      resolveOrbState({
        status,
        awaitingConfirmation,
        outputLevel,
        toolBusy,
      }),
    [status, awaitingConfirmation, outputLevel, toolBusy]
  );

  const orbLabel = useMemo(
    () => orbCaption(orbState, assistantName, liveHint),
    [orbState, assistantName, liveHint]
  );

  const resetTranscripts = useCallback(() => {
    transcriptSessionRef.current.reset();
  }, []);

  const cleanupVoiceSession = useCallback(() => {
    micRef.current?.stop();
    micRef.current = null;
    connectionRef.current?.close();
    connectionRef.current = null;
    playerRef.current?.stop();
    playerRef.current = null;
    resetTranscripts();
  }, [resetTranscripts]);

  const stopVoice = useCallback(async () => {
    startGenerationRef.current += 1;
    sessionLockRef.current = false;
    greetedRef.current = false;
    pendingWriteRef.current = null;
    speakerRef.current = null;
    setSpeaker(null);
    cleanupVoiceSession();
    setAwaitingConfirmation(false);
    setPendingPreview(null);
    setLastSavedBanner(null);
    setAccountChoices([]);
    setToolBusy(false);
    setInputLevel(0);
    setOutputLevel(0);
    setStatus("idle");
    setLiveHint("Voice session ended.");
  }, [cleanupVoiceSession]);

  const startVoice = useCallback(async () => {
    const startId = ++startGenerationRef.current;
    sessionLockRef.current = true;
    greetedRef.current = false;
    speakerRef.current = null;
    setSpeaker(null);

    cleanupVoiceSession();

    setError(null);
    setAwaitingConfirmation(false);
    setToolBusy(false);
    setInputLevel(0);
    setOutputLevel(0);
    setStatus("connecting");
    setLiveHint("Connecting…");
    setLines([]);

    let micOwned = false;
    const micStreamPromise = requestLiveMicStream();
    const dropUnusedMic = () => {
      if (micOwned) return;
      void micStreamPromise.then(
        (stream) => stream.getTracks().forEach((track) => track.stop()),
        () => undefined
      );
    };

    try {
      const playbackContext = getPlaybackAudioContext();
      const captureContext = getCaptureAudioContext();
      void playbackContext.resume();
      void captureContext.resume();

      setLiveHint("Loading your accounts…");
      const financePromise = getClientFinancePayload(HOUSEHOLD_CHAT_USER);
      const audioPromise = ensureAudioUnlocked();
      const financeState = await financePromise;
      const behaviorInstructions = getBehaviorInstructionsForAssistant();
      const reminders = getRemindersForAssistant();
      if (startId !== startGenerationRef.current) {
        dropUnusedMic();
        return;
      }

      setLiveHint("Starting live voice…");
      const tokenPromise = fetchLiveTokenPayload({
        assistant_name: assistantName,
        voice_gender: voiceGender,
        finance_state: financeState,
        behavior_instructions: behaviorInstructions,
        reminders,
      });

      setLiveHint("Unlocking microphone…");
      await audioPromise;
      if (startId !== startGenerationRef.current) {
        dropUnusedMic();
        return;
      }

      const player = new LiveAudioPlayer({
        audioContext: playbackContext,
        onLevel: setOutputLevel,
      });
      playerRef.current = player;
      let heardModelAudio = false;
      const tokenPayload = await tokenPromise;
      if (startId !== startGenerationRef.current) {
        dropUnusedMic();
        return;
      }

      const connection = await connectLiveVoiceWithRetry({
        ephemeralToken: tokenPayload.token,
        model: tokenPayload.model,
        assistantName,
        voiceGender,
        callbacks: {
          onOpen: () => {
            if (startId !== startGenerationRef.current) return;
            setStatus("live");
            setHasUsedVoice(true);
            setLiveHint(`${assistantName} is listening — speak naturally.`);
          },
          onClose: (reason) => {
            if (startId !== startGenerationRef.current) return;
            sessionLockRef.current = false;
            setAwaitingConfirmation(false);
            setToolBusy(false);
            if (connectionRef.current) {
              setStatus("idle");
              setLiveHint(reason ? `Session ended: ${reason}` : "Session ended.");
            }
          },
          onError: (message, fatal) => {
            if (startId !== startGenerationRef.current) return;
            if (fatal) {
              setError(message);
              setStatus("error");
              void stopVoice();
              return;
            }
            setLiveHint("Brief connection hiccup — still listening.");
          },
          onInputTranscription: (event) => {
            transcriptSessionRef.current.addUserFragment(event.text, {
              finished: event.finished,
              interim: event.interim,
            });
          },
          onOutputTranscription: (event) => {
            transcriptSessionRef.current.addModelFragment(event.text, event.finished);
          },
          onTurnComplete: () => {
            transcriptSessionRef.current.onTurnComplete();
          },
          onInterrupted: () => {
            // Do not dump the speaker queue here. Echo / leftover mic often
            // marks the model as interrupted before any speech is audible.
            transcriptSessionRef.current.onInterrupted();
          },
          onModelAudio: (base64Pcm) => {
            if (startId !== startGenerationRef.current) return;
            heardModelAudio = true;
            player.enqueueBase64Pcm(base64Pcm);
          },
          onToolCall: async (toolCall) => {
            if (startId !== startGenerationRef.current) return;
            setToolBusy(true);
            const calls = (toolCall.functionCalls ?? []).map((call, index) => ({
              id: call.id ?? `${call.name ?? "tool"}-${index}`,
              name: call.name ?? "unknown",
              args: call.args ?? {},
            }));
            if (calls.length === 0) {
              setToolBusy(false);
              return;
            }

            const actor = speakerRef.current;
            const writeCalls = calls.filter((item) => isWriteTool(item.name));
            if (writeCalls.length > 0 && !actor) {
              const writeCall = writeCalls[0]!;
              pendingWriteRef.current = mergePendingWrite(pendingWriteRef.current, writeCall);
              setPendingPreview(buildToolConfirmationPreview(pendingWriteRef.current));
              setAwaitingConfirmation(true);
              setLiveHint("Who am I talking to — Kushvanth or Grishma?");
              setToolBusy(false);
              connectionRef.current?.sendToolResponse(
                calls.map((call) => ({
                  id: call.id,
                  name: call.name,
                  response: isWriteTool(call.name)
                    ? {
                        ok: false,
                        needs_speaker: true,
                        saved: false,
                        error: "Who am I talking to — Kushvanth or Grishma?",
                      }
                    : { ok: true },
                }))
              );
              return;
            }
            const prepared = calls.map((call) =>
              isWriteTool(call.name) && actor ? applySpeakerToWrite(call, actor) : call
            );

            const results = await executeLiveToolCallsSafely(() =>
              executeAssistantTools(actor ?? HOUSEHOLD_CHAT_USER, prepared)
            );

            const writeCall = prepared.find((item) => isWriteTool(item.name));
            const pending = results.some(
              (result) =>
                result.response?.status === "needs_confirmation" ||
                result.response?.needs_account === true ||
                result.response?.needs_cash_source === true ||
                result.response?.needs_payer === true
            );
            if (writeCall && !results.some((result) => result.response?.saved === true)) {
              const fromTalk = pendingWriteRef.current;
              const merged = applySpeakerToWrite(
                fromTalk ? mergePendingWrite(writeCall, fromTalk) : writeCall,
                actor
              );
              pendingWriteRef.current = merged;
              setPendingPreview(buildToolConfirmationPreview(merged));
            }
            const accountNeed = results.find((result) => result.response?.needs_account === true);
            const cashSourceNeed = results.find(
              (result) => result.response?.needs_cash_source === true
            );
            const payerNeed = results.find((result) => result.response?.needs_payer === true);
            if (cashSourceNeed) {
              setAccountChoiceKind("cash-source");
              setAccountChoices(chipsFromToolAccounts(cashSourceNeed.response?.accounts, true));
              setAwaitingConfirmation(false);
            } else if (accountNeed) {
              setAccountChoiceKind("pay-from");
              setAccountChoices(chipsFromToolAccounts(accountNeed.response?.accounts));
              setAwaitingConfirmation(false);
            }
            const failed = results.some((result) => result.response?.ok === false);
            const savedMoney = results.some(
              (result) => isWriteTool(result.name) && result.response?.saved === true
            );
            const savedNote = results.some(
              (result) =>
                result.response?.saved === true &&
                (result.name === "save_reminder" ||
                  result.name === "save_behavior_preference" ||
                  result.name === "mark_reminder_done")
            );
            if (savedMoney && writeCall) {
              lastSavedRef.current = { key: writeKey(writeCall), at: Date.now() };
              pendingWriteRef.current = null;
              setPendingPreview(null);
              setAccountChoices([]);
              setAwaitingConfirmation(false);
              const spoken = spokenSaveConfirmation(writeCall);
              setLastSavedBanner(spoken);
              setLiveHint(spoken);
              window.setTimeout(() => setLastSavedBanner(null), 8000);
            }

            if (pending && !savedMoney && !accountNeed && !cashSourceNeed) {
              setAwaitingConfirmation(true);
              setLiveHint(
                payerNeed ||
                  (pendingWriteRef.current
                    ? expenseWriteNeedsPayer(pendingWriteRef.current)
                    : false)
                  ? "Who paid — Kushvanth, Grishma, or both?"
                  : 'Say "yes" to save, or "no" to change it.'
              );
            } else if (cashSourceNeed && !savedMoney) {
              setLiveHint("Cash wallet is low — tap where the cash came from, then say yes.");
            } else if (accountNeed && !savedMoney) {
              setLiveHint("Tap an account, then say yes.");
            } else if (failed && !savedMoney) {
              setAwaitingConfirmation(false);
              setLiveHint("Need one more detail — check what I asked.");
            } else if (savedNote) {
              setAwaitingConfirmation(false);
              setLiveHint("Saved — still listening.");
              window.setTimeout(() => {
                setLiveHint(`${assistantName} is listening — speak naturally.`);
              }, 2000);
            } else if (savedMoney) {
              setLiveHint(spokenSaveConfirmation(writeCall!));
            } else {
              setAwaitingConfirmation(false);
              setLiveHint("Done — still listening.");
              window.setTimeout(() => {
                setLiveHint(`${assistantName} is listening — speak naturally.`);
              }, 2000);
            }

            setToolBusy(false);
            if (startId === startGenerationRef.current) {
              connectionRef.current?.sendToolResponse(results);
            }
          },
        },
      });

      if (startId !== startGenerationRef.current) {
        dropUnusedMic();
        connection.close();
        player.stop();
        return;
      }

      connectionRef.current = connection;

      let micStream: MediaStream | null = null;
      try {
        micStream = await micStreamPromise;
      } catch (micError) {
        if (startId !== startGenerationRef.current) {
          connection.close();
          player.stop();
          return;
        }
        throw micError;
      }

      if (startId !== startGenerationRef.current) {
        micStream.getTracks().forEach((track) => track.stop());
        connection.close();
        player.stop();
        return;
      }

      let bargeChunks = 0;
      let echoUntil = 0;
      let micHandle: MicStreamer | null = null;

      const mic = await startMicStreamer(
        (chunk) => {
          if (startId !== startGenerationRef.current) return;
          connection.sendAudioChunk(chunk);
        },
        (level) => {
          setInputLevel(level);
          const now = performance.now();
          if (!heardModelAudio) {
            micHandle?.setSending(false);
            return;
          }
          if (player.isSpeaking) {
            echoUntil = now + ECHO_HOLD_MS;
            if (level >= BARGE_IN_LEVEL) {
              bargeChunks += 1;
              if (bargeChunks >= BARGE_IN_CHUNKS) {
                player.interrupt();
                micHandle?.setSending(true);
                bargeChunks = 0;
              } else {
                micHandle?.setSending(false);
              }
            } else {
              bargeChunks = 0;
              micHandle?.setSending(false);
            }
            return;
          }

          bargeChunks = 0;
          micHandle?.setSending(now >= echoUntil);
        },
        { audioContext: captureContext, stream: micStream, sending: false }
      );
      micHandle = mic;
      micOwned = true;

      if (startId !== startGenerationRef.current) {
        mic.stop();
        connection.close();
        player.stop();
        return;
      }

      micRef.current = mic;

      window.setTimeout(() => {
        if (startId !== startGenerationRef.current) return;
        if (!heardModelAudio) {
          heardModelAudio = true;
          mic.setSending(true);
        }
      }, 3000);

      if (!greetedRef.current) {
        greetedRef.current = true;
        echoUntil = performance.now() + 2500;
        mic.setSending(false);
        player.interrupt();
        connection.sendGreeting(askWhoIsSpeakingPrompt());
        setLiveHint("Who am I talking to — Kushvanth or Grishma?");
      }
    } catch (err) {
      dropUnusedMic();
      if (startId !== startGenerationRef.current) return;
      sessionLockRef.current = false;
      cleanupVoiceSession();
      setStatus("error");
      const raw = err instanceof Error ? err.message : "Failed to start live voice.";
      const blocked = /notallowed|permission|denied|could not start audio/i.test(raw);
      setError(
        blocked
          ? "Allow the microphone in the browser bar, then tap Start voice."
          : raw
      );
      setLiveHint(blocked ? "Microphone is blocked." : "Could not start voice session.");
    }
  }, [assistantName, autoStart, cleanupVoiceSession, stopVoice, voiceGender]);

  startVoiceRef.current = startVoice;

  useEffect(() => {
    registerVoiceStarter(startVoice);
    return () => registerVoiceStarter(null);
  }, [registerVoiceStarter, startVoice]);

  useEffect(() => {
    if (voiceStartSignal <= 0 && !autoStart) return;
    const key = voiceStartSignal > 0 ? `s:${voiceStartSignal}` : "auto";
    if (handledVoiceSignalRef.current === key) return;
    setLiveHint("Starting to listen…");

    const timer = window.setTimeout(() => {
      handledVoiceSignalRef.current = key;
      void startVoiceRef.current?.().finally(() => {
        onAutoStartHandled?.();
        clearAutoStart();
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [voiceStartSignal, autoStart, onAutoStartHandled, clearAutoStart]);

  useEffect(() => {
    onLiveChange?.(status === "live" || status === "connecting");
  }, [status, onLiveChange]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, liveHint, awaitingConfirmation]);

  useEffect(() => {
    if (!awaitingConfirmation) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        confirmVoiceWriteRef.current("Yes");
      } else if (event.key === "Escape") {
        event.preventDefault();
        pendingWriteRef.current = null;
        setAwaitingConfirmation(false);
        setPendingPreview(null);
        setLiveHint("Not saved — tell me what to change.");
        playerRef.current?.interrupt();
        connectionRef.current?.sendGreeting(
          "App result (do not call tools): {\"ok\":false,\"saved\":false}. The user said no. Do not save. Ask what to change in one short English sentence."
        );
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [awaitingConfirmation]);

  useEffect(() => {
    return () => {
      startGenerationRef.current += 1;
      sessionLockRef.current = false;
      greetedRef.current = false;
      cleanupVoiceSession();
    };
  }, [cleanupVoiceSession]);

  const sessionActive = status === "live" || status === "connecting";
  const needsSpeaker = sessionActive && !speaker;
  const compactOrb =
    awaitingConfirmation ||
    accountChoices.length > 0 ||
    Boolean(lastSavedBanner) ||
    needsSpeaker;
  const pendingWrite = pendingWriteRef.current;
  const categoryChips =
    awaitingConfirmation &&
    pendingWrite?.name === "record_expense" &&
    !String(pendingWrite.args.category ?? "").trim()
      ? householdCategoryChips()
      : [];

  return (
    <div className="space-y-3">
      {error ? (
        <div
          role="alert"
          className="sticky top-0 z-20 rounded-xl bg-[#ff3b30]/12 border border-[#ff3b30]/30 px-3 py-2 text-[12px] text-[#ff3b30] text-center font-semibold backdrop-blur-md"
        >
          {error}
        </div>
      ) : needsSpeaker ? (
        <div className="sticky top-0 z-20 flex justify-center">
          <div className="w-full max-w-sm rounded-xl bg-[#007aff]/10 border border-[#007aff]/25 px-3 py-2.5 space-y-2 backdrop-blur-md">
            <p className="text-[11px] text-[#007aff] text-center font-medium">
              Who am I talking to?
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SPEAKER_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => {
                    speakerRef.current = chip.id;
                    setSpeaker(chip.id);
                    if (pendingWriteRef.current) {
                      const next = applySpeakerToWrite(pendingWriteRef.current, chip.id);
                      pendingWriteRef.current = next;
                      setPendingPreview(buildToolConfirmationPreview(next));
                    }
                    playerRef.current?.interrupt();
                    connectionRef.current?.sendGreeting(speakingWithConfirmedPrompt(chip.id));
                    setLiveHint(`Talking to ${chip.label}`);
                    if (recentlyAffirmedRef.current) {
                      confirmVoiceWriteRef.current("Yes", { immediate: true });
                    }
                  }}
                  className="min-h-11 rounded-full border border-[#007aff]/40 bg-[#007aff]/15 px-4 py-2 text-[13px] font-semibold text-[#007aff]"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : lastSavedBanner ? (
        <div className="sticky top-0 z-20 flex justify-center">
          <div
            role="status"
            aria-live="polite"
            className="w-full max-w-sm rounded-xl bg-[#34c759]/15 border border-[#34c759]/30 px-3 py-2 text-[12px] text-[#34c759] text-center font-semibold backdrop-blur-md"
          >
            {lastSavedBanner}
          </div>
        </div>
      ) : accountChoices.length > 0 ? (
        <div className="sticky top-0 z-20 flex justify-center">
          <div className="w-full max-w-sm rounded-xl bg-[#007aff]/10 border border-[#007aff]/25 px-3 py-2.5 space-y-2 backdrop-blur-md">
            <p className="text-[11px] text-[#007aff] text-center font-medium">
              {accountChoicePrompt(pendingWriteRef.current?.name ?? "", accountChoiceKind)}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {accountChoices.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => {
                    const pending = pendingWriteRef.current;
                    if (!pending) return;
                    const next = withPickedAccount(pending, account, accountChoiceKind);
                    pendingWriteRef.current = next;
                    setPendingPreview(buildToolConfirmationPreview(next));
                    setAccountChoices([]);
                    setAwaitingConfirmation(true);
                    setLiveHint('Say "yes" or tap Yes, save.');
                  }}
                  className="min-h-11 rounded-full border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/10 px-3.5 py-2 text-[12px] font-semibold"
                >
                  {account.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : awaitingConfirmation ? (
        <div className="sticky top-0 z-20 flex justify-center">
          <div
            role="region"
            aria-label="Confirm this money change"
            className="w-full max-w-sm rounded-xl bg-[#ff9500]/10 border border-[#ff9500]/25 px-3 py-2.5 text-[11px] text-[#ff9500] text-center space-y-2 backdrop-blur-md"
          >
            {pendingPreview ? <p className="font-medium text-[#ffb340]">{pendingPreview}</p> : null}
            {pendingWrite?.name === "record_expense" ? (
              <>
                <div className="flex flex-wrap justify-center gap-2">
                  {EXPENSE_PERSON_CHIPS.map((chip) => {
                    const selected = String(pendingWrite.args.expense_for ?? "") === chip.id;
                    return (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => {
                          const pending = pendingWriteRef.current;
                          if (!pending) return;
                          const next = {
                            ...pending,
                            args: withExpensePerson(pending.args, chip.id),
                          };
                          pendingWriteRef.current = next;
                          setPendingPreview(buildToolConfirmationPreview(next));
                        }}
                        className={`min-h-9 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
                          selected
                            ? "border-[#007aff] bg-[#007aff]/15 text-[#007aff]"
                            : "border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/10 text-foreground"
                        }`}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {EXPENSE_PAID_BY_CHIPS.map((chip) => {
                    const selected = String(pendingWrite.args.paid_by ?? "") === chip.id;
                    return (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => {
                          const pending = pendingWriteRef.current;
                          if (!pending) return;
                          const next = {
                            ...pending,
                            args: withPaidBy(pending.args, chip.id),
                          };
                          pendingWriteRef.current = next;
                          setPendingPreview(buildToolConfirmationPreview(next));
                        }}
                        className={`min-h-9 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
                          selected
                            ? "border-[#007aff] bg-[#007aff]/15 text-[#007aff]"
                            : "border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/10 text-foreground"
                        }`}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}
            {categoryChips.length > 0 ? (
              <div className="flex flex-wrap justify-center gap-2">
                {categoryChips.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => {
                      const pending = pendingWriteRef.current;
                      if (!pending) return;
                      const next = {
                        ...pending,
                        args: { ...pending.args, category: category.name },
                      };
                      pendingWriteRef.current = next;
                      setPendingPreview(buildToolConfirmationPreview(next));
                    }}
                    className="min-h-11 rounded-full border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/10 px-3.5 py-2 text-[12px] font-semibold text-foreground"
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                autoFocus
                disabled={toolBusy}
                onClick={() => confirmVoiceWriteRef.current("Yes", { immediate: true })}
                className="flex-1 min-h-11 rounded-lg bg-[#34c759] text-white py-2 text-[13px] font-semibold disabled:opacity-50"
              >
                Yes, save
              </button>
              <button
                type="button"
                disabled={toolBusy}
                onClick={() => {
                  pendingWriteRef.current = null;
                  recentlyAffirmedRef.current = false;
                  setAwaitingConfirmation(false);
                  setPendingPreview(null);
                  setLiveHint("Not saved — tell me what to change.");
                  playerRef.current?.interrupt();
                  connectionRef.current?.sendGreeting(
                    "App result (do not call tools): {\"ok\":false,\"saved\":false}. The user said no. Do not save. Ask what to change in one short English sentence."
                  );
                }}
                className="flex-1 min-h-11 rounded-lg bg-black/5 dark:bg-white/10 text-foreground py-2 text-[13px] font-semibold disabled:opacity-50"
              >
                No
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className={compactOrb ? "assistant-live-orb-stage assistant-live-orb-stage-compact" : "assistant-live-orb-stage"}>
        <AssistantLiveOrb
          state={orbState}
          inputLevel={inputLevel}
          outputLevel={outputLevel}
          label={orbLabel}
          size={compactOrb ? "md" : "lg"}
        />

        <div className="mt-3 flex items-center gap-2">
          <span
            className={`text-[10px] font-semibold uppercase tracking-wide ${
              status === "live"
                ? "text-[#a8b4ff]"
                : status === "connecting"
                  ? "text-[#c4ceff]"
                  : "text-white/50"
            }`}
          >
            {status}
          </span>
          {speaker ? (
            <span className="text-[10px] text-white/45">· Talking to {PERSON_LABELS[speaker]}</span>
          ) : null}
          {sessionActive ? (
            <span className="text-[10px] text-white/45">· Gemini voice · ChatGPT &amp; Grok on text</span>
          ) : null}
        </div>

        <div className="mt-4 w-full max-w-xs">
          {sessionActive ? (
            <GlassButton
              type="button"
              variant="danger"
              className="w-full"
              onClick={() => void stopVoice()}
            >
              <MicOff className="w-4 h-4" />
              {status === "connecting" ? "Cancel" : "Stop voice"}
            </GlassButton>
          ) : (
            <GlassButton type="button" className="w-full" onClick={() => void startVoice()}>
              <Mic className="w-4 h-4" />
              {status === "error" ? "Try again" : "Start voice"}
            </GlassButton>
          )}
        </div>
      </div>

      {!sessionActive && !hasUsedVoice ? (
        <GlassCard className="!p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted mb-2">
            How voice works
          </p>
          <ol className="space-y-1.5">
            {VOICE_STEPS.map((step, index) => (
              <li key={step} className="flex gap-2 text-[11px] text-muted">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-[#007aff] mt-0.5" />
                <span>
                  <strong className="text-foreground/80">{index + 1}.</strong> {step}
                </span>
              </li>
            ))}
          </ol>
        </GlassCard>
      ) : null}

      <div
        className={`assistant-voice-transcript rounded-xl overflow-y-auto p-3 space-y-2.5 transition-all ${
          compactOrb
            ? "min-h-[12vh] max-h-[22vh]"
            : sessionActive
              ? "min-h-[22vh] max-h-[32vh]"
              : "min-h-[28vh] max-h-[36vh]"
        }`}
      >
        {lines.length > 0 ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                transcriptSessionRef.current.reset();
                setLines([]);
                connectionRef.current?.sendGreeting(
                  "The user cleared this conversation. Forget prior chat. Stay silent until they speak. Do not greet."
                );
              }}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-white/50 hover:text-[#ff3b30]"
            >
              <Trash2 className="w-3 h-3" />
              Clear history
            </button>
          </div>
        ) : null}
        {lines.length === 0 ? (
          <div className={`text-center px-4 ${compactOrb ? "py-3" : "py-8"}`}>
            <p className="text-sm font-medium text-white/85">
              {sessionActive ? "Speak naturally" : `Talk to ${assistantName}`}
            </p>
            <p className="text-xs text-white/45 mt-1">
              {sessionActive
                ? "Your words appear here and save with date and time."
                : "Voice can start automatically. Chats save with date and time, then delete after 30 days."}
            </p>
          </div>
        ) : (
          lines.map((line, index) => (
            <div
              key={line.id}
              className={`flex ${line.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`assistant-voice-bubble max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed break-words ${
                  line.role === "user"
                    ? "assistant-voice-bubble-user"
                    : "assistant-voice-bubble-model"
                } ${line.draft ? "assistant-voice-bubble-draft" : ""} ${
                  index === lines.length - 1 ? "assistant-voice-bubble-latest" : ""
                }`}
              >
                {line.text}
                {line.created_at && !line.draft ? (
                  <p
                    className={`mt-1 text-[10px] ${
                      line.role === "user" ? "text-white/55" : "text-white/40"
                    }`}
                  >
                    {formatChatWhen(line.created_at)}
                  </p>
                ) : null}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
