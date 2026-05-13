import crypto from "node:crypto";

const DEFAULT_TOLERANCE_SECONDS = 300;

export function verifyStripeWebhookSignature(params: {
  rawBody: Buffer;
  signatureHeader: string;
  secret: string;
  nowMs?: number;
  toleranceSeconds?: number;
}) {
  const nowMs = params.nowMs ?? Date.now();
  const toleranceSeconds = params.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const parts = parseStripeSignature(params.signatureHeader);
  if (!parts.timestamp || !parts.v1.length) return false;

  const timestamp = Number(parts.timestamp);
  if (!Number.isFinite(timestamp)) return false;

  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - timestamp);
  if (ageSeconds > toleranceSeconds) return false;

  const signedPayload = `${parts.timestamp}.${params.rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", params.secret).update(signedPayload).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");

  for (const provided of parts.v1) {
    const providedBuffer = Buffer.from(provided, "utf8");
    if (providedBuffer.length !== expectedBuffer.length) continue;
    if (crypto.timingSafeEqual(expectedBuffer, providedBuffer)) return true;
  }
  return false;
}

function parseStripeSignature(header: string) {
  const parts = header
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const signatures: string[] = [];
  let timestamp: string | null = null;
  for (const part of parts) {
    const [key, value] = part.split("=", 2);
    if (!key || !value) continue;
    if (key === "t") timestamp = value;
    if (key === "v1") signatures.push(value);
  }
  return { timestamp, v1: signatures };
}
