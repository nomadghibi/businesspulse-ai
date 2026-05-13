import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const port = 5066;
const base = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server/index.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), NODE_ENV: "test" },
  stdio: "pipe"
});

try {
  await waitForHealth();

  const trialEmail = `trial.${Date.now()}@example.com`;
  const trialRes = await post("/api/public/trial-start", {
    email: trialEmail,
    company: "Gate Test Co",
    source: "test"
  });
  assert.equal(trialRes.status, 200);
  const trial = await trialRes.json() as { ownerEmail: string; temporaryPassword: string };

  const loginRes = await post("/api/auth/login", {
    email: trial.ownerEmail,
    password: trial.temporaryPassword
  });
  assert.equal(loginRes.status, 200);
  const login = await loginRes.json() as { token: string; mustChangePassword: boolean };
  assert.equal(login.mustChangePassword, true);

  const blocked = await fetch(`${base}/api/metrics`);
  assert.equal(blocked.status, 401);

  const blockedAuthed = await fetch(`${base}/api/metrics`, {
    headers: { Authorization: `Bearer ${login.token}` }
  });
  assert.equal(blockedAuthed.status, 403);

  const changed = await post(
    "/api/auth/change-password",
    { currentPassword: trial.temporaryPassword, nextPassword: "newsecure123" },
    login.token
  );
  assert.equal(changed.status, 200);

  const allowed = await fetch(`${base}/api/metrics`, {
    headers: { Authorization: `Bearer ${login.token}` }
  });
  assert.equal(allowed.status, 200);

  console.log("auth-gate.test.ts passed");
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
  throw new Error("API did not become ready for auth gate test");
}

function post(path: string, body: unknown, token?: string) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}
