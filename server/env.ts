export function validateRuntimeEnv() {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return;
  const required = ["APP_BASE_URL"];
  const missing = required.filter((key) => !process.env[key] || !String(process.env[key]).trim());
  if (missing.length) {
    throw new Error(`Missing required production env vars: ${missing.join(", ")}`);
  }
  const demoEnabled = process.env.ENABLE_DEMO_CREDENTIALS !== "false";
  const allowDemoInProd = process.env.ALLOW_DEMO_CREDENTIALS_IN_PRODUCTION === "true";
  if (demoEnabled && !allowDemoInProd) {
    throw new Error("Set ENABLE_DEMO_CREDENTIALS=\"false\" or explicitly set ALLOW_DEMO_CREDENTIALS_IN_PRODUCTION=\"true\".");
  }
}
