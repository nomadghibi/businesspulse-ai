import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const port = 5068;
const base = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server/index.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), NODE_ENV: "test" },
  stdio: "pipe"
});

try {
  await waitForHealth();

  const unauthenticated = await fetch(`${base}/api/ops/metrics`);
  assert.equal(unauthenticated.status, 401);

  const login = await createTrialAndLogin();

  // Generate some request traffic so counters are non-zero.
  const orgRes = await fetch(`${base}/api/organization`, {
    headers: { Authorization: `Bearer ${login.token}` }
  });
  assert.equal(orgRes.status, 200);

  const opsRes = await fetch(`${base}/api/ops/metrics`, {
    headers: { Authorization: `Bearer ${login.token}` }
  });
  assert.equal(opsRes.status, 200);
  const ops = await opsRes.json() as {
    startedAt: string;
    uptimeSeconds: number;
    requests: {
      total: number;
      errors5xx: number;
      byStatusClass: Record<string, number>;
    };
    activeGuards: {
      loginAttemptBuckets: number;
      publicRateLimitBuckets: number;
      inFlightWebhookEvents: number;
    };
    hottestPaths: Array<{ path: string; count: number }>;
  };

  assert.ok(typeof ops.startedAt === "string");
  assert.ok(typeof ops.uptimeSeconds === "number");
  assert.ok(typeof ops.requests.total === "number");
  assert.ok(typeof ops.requests.errors5xx === "number");
  assert.ok(typeof ops.requests.byStatusClass["2xx"] === "number");
  assert.ok(typeof ops.requests.byStatusClass["4xx"] === "number");
  assert.ok(typeof ops.requests.byStatusClass["5xx"] === "number");
  assert.ok(typeof ops.activeGuards.loginAttemptBuckets === "number");
  assert.ok(typeof ops.activeGuards.publicRateLimitBuckets === "number");
  assert.ok(typeof ops.activeGuards.inFlightWebhookEvents === "number");
  assert.ok(Array.isArray(ops.hottestPaths));

  console.log("ops-metrics.test.ts passed");
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
  throw new Error("API did not become ready for ops metrics test");
}

async function createTrialAndLogin() {
  const trialEmail = `trial.ops.${Date.now()}@example.com`;
  const trialRes = await fetch(`${base}/api/public/trial-start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: trialEmail, company: "Ops Test Co", source: "test" })
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
