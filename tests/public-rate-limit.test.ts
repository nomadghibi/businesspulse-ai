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
  for (let i = 0; i < 40; i += 1) {
    const res = await post("/api/public/track", { eventName: `evt_${i}`, payload: {} });
    assert.equal(res.status, 200);
  }
  const blocked = await post("/api/public/track", { eventName: "evt_blocked", payload: {} });
  assert.equal(blocked.status, 429);
  console.log("public-rate-limit.test.ts passed");
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
  throw new Error("API did not become ready for rate-limit test");
}

function post(path: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
