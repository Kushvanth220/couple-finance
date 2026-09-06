import { NextResponse } from "next/server";
import { fetchHouseholdRules, upsertHouseholdRules } from "@/lib/ai/chat-store";

export const dynamic = "force-dynamic";

interface RulesBody {
  rules?: unknown[];
  entries?: unknown[];
}

export async function GET() {
  try {
    const { available, row } = await fetchHouseholdRules();
    return NextResponse.json({
      ok: true,
      // `synced: false` means the table has not been created yet, so the app
      // keeps working from local storage without reporting a failure. An empty
      // table that simply has no row yet is still synced.
      synced: available,
      rules: row?.data.rules ?? [],
      entries: row?.data.entries ?? [],
      updated_at: row?.updated_at ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load rules.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RulesBody;
    const saved = await upsertHouseholdRules({
      rules: Array.isArray(body.rules) ? body.rules : [],
      entries: Array.isArray(body.entries) ? body.entries : [],
    });
    return NextResponse.json({ ok: true, synced: saved !== null, updated_at: saved?.updated_at ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save rules.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
