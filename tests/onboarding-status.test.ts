import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const port = 5067;
const base = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server/index.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), NODE_ENV: "test" },
  stdio: "pipe"
});

try {
  await waitForHealth();
  const login = await createTrialAndLogin();

  const before = await getOnboarding(login.token);
  assert.equal(before.firstUploadAt, null);
  assert.equal(before.coreDatasetsCompletedAt, null);
  assert.equal(before.timeToFirstInsightSeconds, null);

  await uploadDataset(login.token, "jobs", "job_id,completed_at\nJ-1,2026-05-13T10:00:00.000Z\n");
  const afterFirst = await getOnboarding(login.token);
  assert.ok(afterFirst.firstUploadAt);
  assert.equal(afterFirst.coreDatasetsCompletedAt, null);
  assert.equal(afterFirst.timeToFirstInsightSeconds, null);

  await uploadDataset(login.token, "leads", "lead_id,created_at\nL-1,2026-05-13T09:00:00.000Z\n");
  await uploadDataset(login.token, "revenue", "amount,paid_at\n120.50,2026-05-13T09:30:00.000Z\n");
  await uploadDataset(login.token, "marketing_spend", "date,spend\n2026-05-13,42.00\n");

  const afterComplete = await getOnboarding(login.token);
  assert.ok(afterComplete.firstUploadAt);
  assert.ok(afterComplete.coreDatasetsCompletedAt);
  assert.ok(typeof afterComplete.timeToFirstInsightSeconds === "number");
  assert.ok((afterComplete.timeToFirstInsightSeconds ?? -1) >= 0);

  console.log("onboarding-status.test.ts passed");
} finally {
  server.kill("SIGTERM");
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {}
    await sleep(150);
  }
  throw new Error("API did not become ready for onboarding status test");
}

async function createTrialAndLogin() {
  const trialEmail = `trial.onboarding.${Date.now()}@example.com`;
  const trialRes = await fetch(`${base}/api/public/trial-start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: trialEmail, company: "Onboarding Test Co", source: "test" })
  });
  assert.equal(trialRes.status, 200);
  const trial = await trialRes.json() as { ownerEmail: string; temporaryPassword: string };

  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: trial.ownerEmail, password: trial.temporaryPassword })
  });
  assert.equal(res.status, 200);
  const login = await res.json() as { token: string };

  const changePassword = await fetch(`${base}/api/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${login.token}`
    },
    body: JSON.stringify({ currentPassword: trial.temporaryPassword, nextPassword: "newsecure123" })
  });
  assert.equal(changePassword.status, 200);

  return login;
}

async function uploadDataset(token: string, datasetType: "jobs" | "leads" | "revenue" | "marketing_spend", csv: string) {
  const form = new FormData();
  form.append("datasetType", datasetType);
  form.append("mode", "commit");
  form.append("file", new Blob([csv], { type: "text/csv" }), `${datasetType}.csv`);
  const res = await fetch(`${base}/api/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  assert.equal(res.status, 200);
}

async function getOnboarding(token: string) {
  const res = await fetch(`${base}/api/onboarding-status`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(res.status, 200);
  return res.json() as Promise<{
    firstUploadAt: string | null;
    coreDatasetsCompletedAt: string | null;
    timeToFirstInsightSeconds: number | null;
  }>;
}
