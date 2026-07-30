import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const householdKey =
    process.env.HOUSEHOLD_SYNC_KEY ??
    process.env.NEXT_PUBLIC_HOUSEHOLD_SYNC_KEY ??
    "grik-finance-couple";

  if (!url || !key) {
    return NextResponse.json({
      ok: false,
      configured: false,
      error: "Missing Supabase URL or anon key in environment.",
    });
  }

  try {
    const supabase = createClient(url, key);
    const { data, error } = await supabase
      .from("household_finance")
      .select("household_id, updated_at, data");

    if (error) {
      return NextResponse.json({
        ok: false,
        configured: true,
        url,
        householdKey,
        error: error.message,
      });
    }

    const rows = (data ?? []).map((row) => ({
      household_id: row.household_id,
      updated_at: row.updated_at,
      transactions: (row.data as { transactions?: unknown[] })?.transactions?.length ?? 0,
      incomeEntries:
        (row.data as { incomeEntries?: unknown[] })?.incomeEntries?.length ?? 0,
    }));

    const matched = rows.find((row) => row.household_id === householdKey);

    return NextResponse.json({
      ok: true,
      configured: true,
      url,
      householdKey,
      rows,
      matched,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      configured: true,
      url,
      householdKey,
      error: error instanceof Error ? error.message : "Unknown connection error",
    });
  }
}
