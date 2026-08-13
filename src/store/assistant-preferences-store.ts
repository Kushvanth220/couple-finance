"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AssistantVoiceGender } from "@/lib/ai/assistant-voice";
import { ASSISTANT_LANGUAGE } from "@/lib/ai/live-config";
import type { Person } from "@/types";

const STORAGE_KEY = "couple-finance-assistant-prefs-v5";
const DEFAULT_NAME = "Jarvis";

interface AssistantPreferencesState {
  assistantName: string;
  voiceGender: AssistantVoiceGender;
  namingCompleted: boolean;
  wakeListeningEnabled: boolean;
  language: typeof ASSISTANT_LANGUAGE;
  behaviorInstructions: string[];
  reminders: string[];
  setAssistantProfile: (profile: { name: string; voiceGender: AssistantVoiceGender }) => void;
  setAssistantName: (name: string) => void;
  setVoiceGender: (voiceGender: AssistantVoiceGender) => void;
  completeNamingWithDefault: () => void;
  setWakeListeningEnabled: (enabled: boolean) => void;
  addBehaviorInstruction: (instruction: string) => void;
  addReminder: (reminder: string) => void;
  markReminderDone: (match: string) => string | null;
  setBehaviorInstructions: (instructions: string[]) => void;
  setReminders: (reminders: string[]) => void;
  hydrateFromServer: () => Promise<void>;
  syncToServer: () => Promise<void>;
  getAssistantName: () => string;
  getVoiceGender: () => AssistantVoiceGender;
  hasCompletedNaming: () => boolean;
}

type LegacyState = {
  names?: Partial<Record<Person, string>>;
  voiceGenders?: Partial<Record<Person, AssistantVoiceGender>>;
  namingCompleted?: Partial<Record<Person, boolean>>;
  wakeListeningEnabled?: boolean;
  assistantName?: string;
  behaviorInstructions?: string[];
  reminders?: string[];
};

function migrateLegacy(state: LegacyState): Partial<AssistantPreferencesState> {
  if (state.assistantName && state.behaviorInstructions) {
    return {
      behaviorInstructions: state.behaviorInstructions,
      language: ASSISTANT_LANGUAGE,
    };
  }

  const pickName = (person: Person) => state.names?.[person]?.trim();
  const name = pickName("kushvanth") ?? pickName("grishma") ?? DEFAULT_NAME;
  return {
    assistantName: name,
    voiceGender: state.voiceGenders?.kushvanth ?? state.voiceGenders?.grishma ?? "female",
    namingCompleted: Boolean(
      state.namingCompleted?.kushvanth || state.namingCompleted?.grishma
    ),
    wakeListeningEnabled: state.wakeListeningEnabled ?? true,
    behaviorInstructions: state.behaviorInstructions ?? [],
    language: ASSISTANT_LANGUAGE,
  };
}

export const useAssistantPreferencesStore = create<AssistantPreferencesState>()(
  persist(
    (set, get) => ({
      assistantName: DEFAULT_NAME,
      voiceGender: "female",
      namingCompleted: false,
      wakeListeningEnabled: true,
      language: ASSISTANT_LANGUAGE,
      behaviorInstructions: [],
      reminders: [],

      setAssistantProfile: (profile) => {
        const trimmed = profile.name.trim().slice(0, 32);
        if (!trimmed) return;
        set({
          assistantName: trimmed,
          voiceGender: profile.voiceGender,
          namingCompleted: true,
        });
        void get().syncToServer();
      },

      setAssistantName: (name) => {
        const trimmed = name.trim().slice(0, 32);
        if (!trimmed) return;
        set({ assistantName: trimmed, namingCompleted: true });
        void get().syncToServer();
      },

      setVoiceGender: (voiceGender) => {
        set({ voiceGender });
        void get().syncToServer();
      },

      completeNamingWithDefault: () => {
        set({ assistantName: DEFAULT_NAME, namingCompleted: true });
        void get().syncToServer();
      },

      setWakeListeningEnabled: (enabled) => {
        set({ wakeListeningEnabled: enabled });
        void get().syncToServer();
      },

      addBehaviorInstruction: (instruction) => {
        const line = instruction.trim().slice(0, 500);
        if (!line) return;
        const current = get().behaviorInstructions;
        if (current.includes(line)) return;
        set({ behaviorInstructions: [...current, line] });
        void get().syncToServer();
      },

      addReminder: (reminder) => {
        const line = reminder.trim().slice(0, 500);
        if (!line) return;
        const current = get().reminders;
        if (current.includes(line)) return;
        set({ reminders: [...current, line] });
        void get().syncToServer();
      },

      markReminderDone: (match) => {
        const needle = match.trim().toLowerCase();
        if (!needle) return null;
        const current = get().reminders;
        const index = current.findIndex((line) => {
          const normalized = line.toLowerCase();
          return !normalized.startsWith("[done]") && normalized.includes(needle);
        });
        if (index < 0) return null;
        const original = current[index]!;
        const next = [...current];
        next[index] = original.startsWith("[DONE]") ? original : `[DONE] ${original}`;
        set({ reminders: next });
        void get().syncToServer();
        return next[index]!;
      },

      setBehaviorInstructions: (instructions) => {
        set({ behaviorInstructions: instructions });
      },

      setReminders: (reminders) => {
        set({ reminders });
      },

      hydrateFromServer: async () => {
        try {
          const response = await fetch("/api/ai/preferences", { cache: "no-store" });
          const payload = await response.json();
          if (!payload.ok || !payload.preferences) return;

          const prefs = payload.preferences as {
            assistant_name?: string | null;
            voice_gender?: string | null;
            wake_listening_enabled?: boolean;
            behavior_instructions?: string[];
            reminders?: string[];
          };

          set((state) => ({
            assistantName: prefs.assistant_name?.trim() || state.assistantName,
            voiceGender:
              prefs.voice_gender === "male" || prefs.voice_gender === "female"
                ? prefs.voice_gender
                : state.voiceGender,
            wakeListeningEnabled: prefs.wake_listening_enabled ?? state.wakeListeningEnabled,
            behaviorInstructions: Array.isArray(prefs.behavior_instructions)
              ? prefs.behavior_instructions
              : state.behaviorInstructions,
            reminders: Array.isArray(prefs.reminders) ? prefs.reminders : state.reminders,
            namingCompleted: state.namingCompleted || Boolean(prefs.assistant_name),
          }));
        } catch {
          // Supabase table may not exist yet — local prefs still work.
        }
      },

      syncToServer: async () => {
        const state = get();
        try {
          await fetch("/api/ai/preferences", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              assistant_name: state.assistantName,
              voice_gender: state.voiceGender,
              wake_listening_enabled: state.wakeListeningEnabled,
              language: state.language,
              behavior_instructions: state.behaviorInstructions,
              reminders: state.reminders,
            }),
          });
        } catch {
          // Offline or table not migrated — ignore.
        }
      },

      getAssistantName: () => get().assistantName.trim() || DEFAULT_NAME,
      getVoiceGender: () => get().voiceGender,
      hasCompletedNaming: () => get().namingCompleted,
    }),
    {
      name: STORAGE_KEY,
      version: 5,
      migrate: (persisted, version) => {
        const state = persisted as LegacyState & Partial<AssistantPreferencesState>;
        if (version < 4) {
          return { ...state, ...migrateLegacy(state), reminders: state.reminders ?? [] };
        }
        if (version < 5) {
          return { ...state, reminders: state.reminders ?? [] };
        }
        return state as AssistantPreferencesState;
      },
    }
  )
);

export function getWakeAssistantName(): string | null {
  const state = useAssistantPreferencesStore.getState();
  if (!state.namingCompleted) return null;
  const name = state.assistantName.trim();
  if (!name || name.toLowerCase() === "assistant") return null;
  return name;
}

export function buildWakeNameEntries(): Array<{ person: Person; name: string }> {
  const name = getWakeAssistantName();
  if (!name) return [];
  return [{ person: "kushvanth", name }];
}

export function getBehaviorInstructionsForAssistant(): string[] {
  return useAssistantPreferencesStore.getState().behaviorInstructions;
}

export function getRemindersForAssistant(): string[] {
  return useAssistantPreferencesStore.getState().reminders;
}
