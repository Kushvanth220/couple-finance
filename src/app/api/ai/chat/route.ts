import { NextResponse } from "next/server";
import { assertAiUserId, parseAiUserId } from "@/lib/ai/person";
import {
  appendChatMessage,
  createUserChatSession,
  deleteExpiredChatSessions,
  getSessionForUser,
  listSessionMessages,
} from "@/lib/ai/chat-store";
import { resolveHouseholdFinanceContext } from "@/lib/ai/resolve-finance-context";
import {
  continueCouncilWithToolResults,
  generateCouncilReply,
} from "@/lib/ai/council";
import type { GeminiToolResponseInput } from "@/lib/ai/gemini-client";
import type { Part } from "@google/generative-ai";
import type { FinanceState } from "@/types";
import { ENGLISH_ONLY_REPLY, looksNonEnglish } from "@/lib/ai/live-transcript";

export const dynamic = "force-dynamic";

interface ChatRequestBody {
  user_id?: string;
  message?: string;
  session_id?: string;
  assistant_name?: string;
  finance_state?: FinanceState;
  behavior_instructions?: string[];
  reminders?: string[];
  speaking_with?: string;
  tool_continuation?: {
    user_message: string;
    model_parts: Part[];
    tool_responses: GeminiToolResponseInput[];
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequestBody;
    const userId = assertAiUserId(body.user_id);
    const continuation = body.tool_continuation;
    await deleteExpiredChatSessions(userId);

    let sessionId = body.session_id;
    if (!sessionId && !continuation) {
      const created = await createUserChatSession(userId);
      sessionId = created.id;
    } else if (sessionId) {
      const existing = await getSessionForUser(sessionId, userId);
      if (!existing) {
        return NextResponse.json(
          { ok: false, error: "Session not found for this user." },
          { status: 404 }
        );
      }
    } else if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "session_id is required for tool continuation." },
        { status: 400 }
      );
    }

    const financeContext = await resolveHouseholdFinanceContext(body.finance_state);

    const priorMessages = await listSessionMessages(sessionId!, userId);
    const history = priorMessages.map((entry) => ({
      role: entry.role,
      content: entry.content,
    }));

    const assistantName = body.assistant_name?.trim();
    const behaviorInstructions = Array.isArray(body.behavior_instructions)
      ? body.behavior_instructions
      : [];
    const reminders = Array.isArray(body.reminders) ? body.reminders : [];
    const speakingWith = parseAiUserId(body.speaking_with);

    if (continuation) {
      const outcome = await continueCouncilWithToolResults({
        userId,
        financeContext,
        assistantName,
        behaviorInstructions,
        reminders,
        speakingWith,
        history,
        message: continuation.user_message,
        userMessage: continuation.user_message,
        modelParts: continuation.model_parts,
        toolResponses: continuation.tool_responses,
      });

      if (outcome.kind === "tool_calls") {
        return NextResponse.json({
          ok: true,
          user_id: userId,
          session_id: sessionId,
          needs_tools: true,
          tool_calls: outcome.toolCalls,
          model_parts: outcome.modelParts,
          user_message: continuation.user_message,
          providers: outcome.providers,
        });
      }

      const saved = await appendChatMessage(sessionId!, userId, "model", outcome.reply);
      return NextResponse.json({
        ok: true,
        user_id: userId,
        session_id: sessionId,
        reply: outcome.reply,
        message: saved,
        providers: outcome.providers,
      });
    }

    const message = body.message?.trim();
    if (!message) {
      return NextResponse.json({ ok: false, error: "message is required." }, { status: 400 });
    }

    await appendChatMessage(sessionId!, userId, "user", message);

    if (looksNonEnglish(message)) {
      const saved = await appendChatMessage(sessionId!, userId, "model", ENGLISH_ONLY_REPLY);
      return NextResponse.json({
        ok: true,
        user_id: userId,
        session_id: sessionId,
        reply: ENGLISH_ONLY_REPLY,
        message: saved,
      });
    }

    const outcome = await generateCouncilReply({
      userId,
      financeContext,
      assistantName,
      behaviorInstructions,
      reminders,
      speakingWith,
      history,
      message,
    });

    if (outcome.kind === "tool_calls") {
      return NextResponse.json({
        ok: true,
        user_id: userId,
        session_id: sessionId,
        needs_tools: true,
        tool_calls: outcome.toolCalls,
        model_parts: outcome.modelParts,
        user_message: message,
        providers: outcome.providers,
      });
    }

    const saved = await appendChatMessage(sessionId!, userId, "model", outcome.reply);

    return NextResponse.json({
      ok: true,
      user_id: userId,
      session_id: sessionId,
      reply: outcome.reply,
      message: saved,
      providers: outcome.providers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat request failed.";
    const status =
      message.includes("GEMINI_API_KEY") ||
      message.includes("OPENAI_API_KEY") ||
      message.includes("XAI_API_KEY") ||
      message.includes("No AI provider")
        ? 503
        : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
