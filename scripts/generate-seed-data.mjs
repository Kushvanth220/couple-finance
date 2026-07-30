import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function resolveSourcePath(argPath) {
  if (argPath) {
    return path.isAbsolute(argPath) ? argPath : path.join(root, argPath);
  }

  const latest = path.join(root, "docs", "supabase-export.json");
  if (fs.existsSync(latest)) return latest;

  const backupsDir = path.join(root, "backups");
  if (!fs.existsSync(backupsDir)) {
    throw new Error("No backup found. Run: npm run backup:supabase");
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

  throw new Error("No backup found. Run: npm run backup:supabase");
}

const sourcePath = resolveSourcePath(process.argv[2]);
const payload = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

if (!payload?.data || !payload?.household_id) {
  throw new Error(`Invalid export file: ${sourcePath}`);
}

const targetPath = path.join(root, "src", "data", "household-finance.json");
fs.mkdirSync(path.dirname(targetPath), { recursive: true });
fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2));

console.log("Seed updated:", targetPath);
console.log(
  JSON.stringify(
    {
      household_id: payload.household_id,
      updated_at: payload.updated_at,
      transactions: payload.data.transactions?.length ?? 0,
      accounts: payload.data.accounts?.length ?? 0,
    },
    null,
    2
  )
);
