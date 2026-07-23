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

  return NextResponse.json({
    configured: Boolean(url && key),
    supabaseUrl: url ?? null,
    supabaseAnonKey: key ?? null,
    householdKey,
  });
}
