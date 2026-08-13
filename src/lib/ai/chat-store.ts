import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AiUserId } from "@/lib/ai/person";

export interface AiChatSession {
  id: string;
  household_id: string;
  user_id: AiUserId;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiChatMessage {
  id: string;
  session_id: string;
  household_id: string;
  user_id: AiUserId;
  role: "user" | "model";
  content: string;
  created_at: string;
}

function getServerSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase is not configured.");
  }
  return createClient(url, key);
}

export function getHouseholdId(): string {
  return (
    process.env.HOUSEHOLD_SYNC_KEY ??
    process.env.NEXT_PUBLIC_HOUSEHOLD_SYNC_KEY ??
    "grik-finance-couple"
  );
}

export const CHAT_RETENTION_DAYS = 30;

export async function deleteExpiredChatSessions(
  userId: AiUserId,
  householdId = getHouseholdId()
) {
  const supabase = getServerSupabase();
  const cutoff = new Date(Date.now() - CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("ai_chat_sessions")
    .delete()
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .lt("updated_at", cutoff);

  if (error) throw new Error(error.message);
}

export async function listUserChatSessions(userId: AiUserId, householdId = getHouseholdId()) {
  await deleteExpiredChatSessions(userId, householdId);
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("ai_chat_sessions")
    .select("*")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(error.message);
  return (data ?? []) as AiChatSession[];
}

export async function getSessionForUser(
  sessionId: string,
  userId: AiUserId,
  householdId = getHouseholdId()
): Promise<AiChatSession | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("ai_chat_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as AiChatSession | null) ?? null;
}

export async function createUserChatSession(userId: AiUserId, title?: string) {
  const supabase = getServerSupabase();
  const householdId = getHouseholdId();
  const { data, error } = await supabase
    .from("ai_chat_sessions")
    .insert({
      household_id: householdId,
      user_id: userId,
      title: title ?? "New chat",
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as AiChatSession;
}

export async function listSessionMessages(
  sessionId: string,
  userId: AiUserId,
  householdId = getHouseholdId()
) {
  const session = await getSessionForUser(sessionId, userId, householdId);
  if (!session) throw new Error("Chat session not found for this user.");

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("ai_chat_messages")
    .select("*")
    .eq("session_id", sessionId)
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as AiChatMessage[];
}

export async function appendChatMessage(
  sessionId: string,
  userId: AiUserId,
  role: "user" | "model",
  content: string
) {
  const householdId = getHouseholdId();
  const session = await getSessionForUser(sessionId, userId, householdId);
  if (!session) throw new Error("Chat session not found for this user.");

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("ai_chat_messages")
    .insert({
      session_id: sessionId,
      household_id: householdId,
      user_id: userId,
      role,
      content,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  await supabase
    .from("ai_chat_sessions")
    .update({
      updated_at: new Date().toISOString(),
      title:
        session.title === "New chat" && role === "user"
          ? content.slice(0, 60)
          : session.title,
    })
    .eq("id", sessionId)
    .eq("user_id", userId);

  return data as AiChatMessage;
}

export async function deleteUserChatSession(
  sessionId: string,
  userId: AiUserId,
  householdId = getHouseholdId()
) {
  const session = await getSessionForUser(sessionId, userId, householdId);
  if (!session) throw new Error("Chat session not found for this user.");

  const supabase = getServerSupabase();
  const { error: messagesError } = await supabase
    .from("ai_chat_messages")
    .delete()
    .eq("session_id", sessionId)
    .eq("household_id", householdId)
    .eq("user_id", userId);

  if (messagesError) throw new Error(messagesError.message);

  const { error: sessionError } = await supabase
    .from("ai_chat_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("household_id", householdId)
    .eq("user_id", userId);

  if (sessionError) throw new Error(sessionError.message);
}

export async function deleteAllUserChatSessions(
  userId: AiUserId,
  householdId = getHouseholdId()
) {
  const supabase = getServerSupabase();
  const { error: messagesError } = await supabase
    .from("ai_chat_messages")
    .delete()
    .eq("household_id", householdId)
    .eq("user_id", userId);

  if (messagesError) throw new Error(messagesError.message);

  const { error: sessionError } = await supabase
    .from("ai_chat_sessions")
    .delete()
    .eq("household_id", householdId)
    .eq("user_id", userId);

  if (sessionError) throw new Error(sessionError.message);
}

export async function fetchHouseholdFinance(householdId = getHouseholdId()) {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("household_finance")
    .select("data")
    .eq("household_id", householdId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.data ?? null;
}

export interface AssistantPreferencesRow {
  household_id: string;
  assistant_name: string | null;
  voice_gender: string | null;
  wake_listening_enabled: boolean;
  language: string;
  behavior_instructions: string[];
  reminders: string[];
  updated_at: string;
}

export async function fetchAssistantPreferences(
  householdId = getHouseholdId()
): Promise<AssistantPreferencesRow | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("assistant_preferences")
    .select("*")
    .eq("household_id", householdId)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01") return null;
    throw new Error(error.message);
  }
  if (!data) return null;

  const row = data as Record<string, unknown>;
  return {
    household_id: String(row.household_id),
    assistant_name: row.assistant_name ? String(row.assistant_name) : null,
    voice_gender: row.voice_gender ? String(row.voice_gender) : null,
    wake_listening_enabled: Boolean(row.wake_listening_enabled ?? true),
    language: String(row.language ?? "en-US"),
    behavior_instructions: Array.isArray(row.behavior_instructions)
      ? (row.behavior_instructions as string[])
      : [],
    reminders: Array.isArray(row.reminders) ? (row.reminders as string[]) : [],
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  };
}

export async function upsertAssistantPreferences(
  payload: Partial<Omit<AssistantPreferencesRow, "household_id" | "updated_at">> & {
    behavior_instructions?: string[];
    reminders?: string[];
  },
  householdId = getHouseholdId()
) {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("assistant_preferences")
    .upsert(
      {
        household_id: householdId,
        ...payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "household_id" }
    )
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as AssistantPreferencesRow;
}
