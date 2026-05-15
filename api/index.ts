import type { IncomingMessage, ServerResponse } from "node:http";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const { app, ensureInitialized } = await import("../server/index.js");
    await ensureInitialized();
    return app(req as any, res as any);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown initialization error";
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "API initialization failed", detail: message }));
  }
}
