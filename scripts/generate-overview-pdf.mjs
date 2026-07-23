import puppeteer from "puppeteer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const htmlPath = path.join(root, "docs", "kg-finance-project-overview.html");
const pdfPath = path.join(root, "docs", "KG-Finance-Project-Overview.pdf");

if (!fs.existsSync(htmlPath)) {
  console.error("HTML source not found:", htmlPath);
  process.exit(1);
}

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();

await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, {
  waitUntil: "networkidle0",
});

await page.waitForFunction(() => {
  const nodes = document.querySelectorAll(".mermaid");
  if (!nodes.length) return true;
  return [...nodes].every((node) => node.querySelector("svg"));
}, { timeout: 30000 });

await page.pdf({
  path: pdfPath,
  format: "A4",
  printBackground: true,
  margin: { top: "16mm", right: "14mm", bottom: "16mm", left: "14mm" },
});

await browser.close();
console.log("PDF created:", pdfPath);
