import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const port = 5069;
const base = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server/index.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), NODE_ENV: "test" },
  stdio: "pipe"
});

try {
  await waitForHealth();
  const owner = await createTrialAndLogin();

  // Starter limit is 3 users total, including owner.
  const invite1 = await inviteUser(owner.token, `u1.${Date.now()}@example.com`);
  assert.equal(invite1.status, 200);
  const invite2 = await inviteUser(owner.token, `u2.${Date.now()}@example.com`);
  assert.equal(invite2.status, 200);
  const invite3 = await inviteUser(owner.token, `u3.${Date.now()}@example.com`);
  assert.equal(invite3.status, 402);

  console.log("plan-user-limits.test.ts passed");
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
  throw new Error("API did not become ready for plan user limits test");
}

async function createTrialAndLogin() {
  const trialEmail = `trial.plan.${Date.now()}@example.com`;
  const trialRes = await fetch(`${base}/api/public/trial-start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: trialEmail, company: "Plan Test Co", source: "test" })
  });
  assert.equal(trialRes.status, 200);
  const trial = await trialRes.json() as { ownerEmail: string; temporaryPassword: string };

  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: trial.ownerEmail, password: trial.temporaryPassword })
  });
  assert.equal(loginRes.status, 200);
  const login = await loginRes.json() as { token: string };

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

function inviteUser(token: string, email: string) {
  return fetch(`${base}/api/users/invite`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ email, role: "viewer", password: "viewerpass123" })
  });
}
