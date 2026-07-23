import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnv() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) {
    throw new Error(".env.local not found");
  }

  const env = Object.fromEntries(
    fs
      .readFileSync(envPath, "utf8")
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
      })
  );

  return {
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    key: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    householdKey: env.NEXT_PUBLIC_HOUSEHOLD_SYNC_KEY ?? "grik-finance-couple",
  };
}

const { url, key, householdKey } = loadEnv();

if (!url || !key) {
  throw new Error("Missing Supabase URL or anon key in .env.local");
}

const supabase = createClient(url, key);

const { data, error } = await supabase
  .from("household_finance")
  .select("household_id, data, updated_at")
  .eq("household_id", householdKey)
  .maybeSingle();

if (error) {
  console.error("Supabase error:", error.message);
  process.exit(1);
}

if (!data) {
  console.log("No row found for household:", householdKey);
  process.exit(0);
}

const outDir = path.join(root, "docs");
fs.mkdirSync(outDir, { recursive: true });

const exportPath = path.join(outDir, "supabase-export.json");
const summaryPath = path.join(outDir, "supabase-export-summary.json");

const finance = data.data ?? {};
const summary = {
  household_id: data.household_id,
  updated_at: data.updated_at,
  counts: {
    incomeSources: finance.incomeSources?.length ?? 0,
    incomeEntries: finance.incomeEntries?.length ?? 0,
    monthlyExpenses: finance.monthlyExpenses?.length ?? 0,
    accounts: finance.accounts?.length ?? 0,
    debts: finance.debts?.length ?? 0,
    transactions: finance.transactions?.length ?? 0,
    interCoupleHistory: finance.interCoupleHistory?.length ?? 0,
    deletedHistory: finance.deletedHistory?.length ?? 0,
  },
  interCoupleBalance: finance.interCoupleBalance ?? 0,
};

fs.writeFileSync(
  exportPath,
  JSON.stringify(
    {
      household_id: data.household_id,
      updated_at: data.updated_at,
      data: finance,
    },
    null,
    2
  )
);

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log("Export saved:", exportPath);
console.log("Summary saved:", summaryPath);
console.log(JSON.stringify(summary, null, 2));
