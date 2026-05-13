import crypto from "node:crypto";
import assert from "node:assert/strict";
import { verifyStripeWebhookSignature } from "../server/stripeWebhook";

const secret = "whsec_test_secret";
const nowMs = Date.parse("2026-05-13T12:00:00.000Z");
const payload = Buffer.from(JSON.stringify({ id: "evt_123", type: "payment_intent.succeeded" }));
const timestamp = Math.floor(nowMs / 1000);

function sign(ts: number, body: Buffer) {
  return crypto.createHmac("sha256", secret).update(`${ts}.${body.toString("utf8")}`).digest("hex");
}

const validSignature = sign(timestamp, payload);
const validHeader = `t=${timestamp},v1=${validSignature}`;

assert.equal(
  verifyStripeWebhookSignature({ rawBody: payload, signatureHeader: validHeader, secret, nowMs }),
  true
);

assert.equal(
  verifyStripeWebhookSignature({ rawBody: payload, signatureHeader: `t=${timestamp},v1=deadbeef`, secret, nowMs }),
  false
);

const staleTimestamp = timestamp - 301;
assert.equal(
  verifyStripeWebhookSignature({
    rawBody: payload,
    signatureHeader: `t=${staleTimestamp},v1=${sign(staleTimestamp, payload)}`,
    secret,
    nowMs
  }),
  false
);

assert.equal(
  verifyStripeWebhookSignature({ rawBody: payload, signatureHeader: "v1=missing_timestamp", secret, nowMs }),
  false
);

console.log("stripe-webhook.test.ts passed");
