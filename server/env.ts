export function validateRuntimeEnv() {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return;
  const required = ["DATABASE_URL", "APP_BASE_URL"];
  const missing = required.filter((key) => !process.env[key] || !String(process.env[key]).trim());
  if (missing.length) {
    throw new Error(`Missing required production env vars: ${missing.join(", ")}`);
  }
}
