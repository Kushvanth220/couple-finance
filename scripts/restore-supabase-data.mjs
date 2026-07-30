import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnv() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) {
    throw new Error(".env.local not found — add your NEW Supabase URL and anon key first");
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

function resolveBackupPath(argPath) {
  if (argPath) {
    return path.isAbsolute(argPath) ? argPath : path.join(root, argPath);
  }

  const latest = path.join(root, "docs", "supabase-export.json");
  if (fs.existsSync(latest)) return latest;

  const backupsDir = path.join(root, "backups");
  if (!fs.existsSync(backupsDir)) {
    throw new Error("No backup file found. Run: npm run backup:supabase");
  }

  const folders = fs
    .readdirSync(backupsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const folder of folders) {
    const candidate = path.join(backupsDir, folder, "household-finance.json");
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error("No backup file found. Run: npm run backup:supabase");
}

const backupArg = process.argv[2];
const backupPath = resolveBackupPath(backupArg);
const payload = JSON.parse(fs.readFileSync(backupPath, "utf8"));

if (!payload?.data || !payload?.household_id) {
  throw new Error(`Invalid backup file: ${backupPath}`);
}

const { url, key, householdKey } = loadEnv();

if (!url || !key) {
  throw new Error("Missing Supabase URL or anon key in .env.local");
}

console.log("Restore source:", backupPath);
console.log("Target Supabase:", url);
console.log("Household id:", payload.household_id);
console.log("Env household key:", householdKey);

if (payload.household_id !== householdKey) {
  console.warn(
    `Warning: backup household_id (${payload.household_id}) differs from NEXT_PUBLIC_HOUSEHOLD_SYNC_KEY (${householdKey}). Using backup id.`
  );
}

const supabase = createClient(url, key);

const row = {
  household_id: payload.household_id,
  data: payload.data,
};

if (payload.updated_at) {
  row.updated_at = payload.updated_at;
}

const { data, error } = await supabase
  .from("household_finance")
  .upsert(row, { onConflict: "household_id" })
  .select("household_id, updated_at")
  .single();

if (error) {
  console.error("Restore failed:", error.message);
  if (error.message.includes("household_finance")) {
    console.error("\nRun supabase/setup.sql in your NEW project's SQL Editor first.");
  }
  process.exit(1);
}

const finance = payload.data;
console.log("\nRestore complete.");
console.log(
  JSON.stringify(
    {
      household_id: data.household_id,
      updated_at: data.updated_at,
      transactions: finance.transactions?.length ?? 0,
      accounts: finance.accounts?.length ?? 0,
      incomeEntries: finance.incomeEntries?.length ?? 0,
    },
    null,
    2
  )
);
