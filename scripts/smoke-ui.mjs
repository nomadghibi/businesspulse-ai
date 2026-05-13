import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const result = { steps: [] };

try {
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  result.steps.push("loaded_app");

  await page.getByRole("button", { name: /Enter App/i }).click();
  await page.getByRole("button", { name: /Sign in/i }).click();
  await page.waitForSelector("text=Dashboard");
  result.steps.push("logged_in");

  await page.getByRole("button", { name: /Data Sources/i }).click();
  await page.waitForSelector("text=Upload CSV");

  const csv = [
    "job id,customer id,job type,status,completed at,revenue,lead source",
    "J-9001,C-300,HVAC Repair,completed,2026-05-10,1200,Google Ads",
    "J-9002,C-300,HVAC Tune-up,completed,2026-05-11,450,Referral",
    "J-9003,C-301,Drain Cleaning,completed,2026-05-12,300,Organic"
  ].join("\n");

  await page.locator('input[type=\"file\"]').first().setInputFiles({
    name: "jobs-smoke.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv)
  });

  await page.waitForSelector("text=Commit Import", { timeout: 15000 });
  result.steps.push("preview_shown");

  await page.getByRole("button", { name: /Commit Import/i }).click();
  await page.waitForSelector("text=Upload processed successfully.", { timeout: 15000 });
  result.steps.push("commit_success");

  await page.getByRole("button", { name: /Ask AI/i }).click();
  await page.getByRole("button", { name: /^Ask$/i }).click();
  await page.waitForSelector("text=Reasoning And Sources", { timeout: 15000 });
  await page.waitForSelector("text=Evidence", { timeout: 15000 });
  result.steps.push("ask_ai_rendered");

  const hasRevEvidence = await page.locator("text=rev:").first().isVisible().catch(() => false);
  result.hasRevEvidence = hasRevEvidence;

  console.log(JSON.stringify({ ok: true, ...result }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, ...result, error: String(error?.message ?? error) }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
