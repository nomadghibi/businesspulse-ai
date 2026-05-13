import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { answerQuestion } from "./ai";
import { ingestCsv } from "./csv";
import { calculateMetrics, generateAlerts, generateRecommendations, generateReport } from "./metrics";
import { getStorage } from "./storage";
import { defaultPeriod } from "./utils";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const port = Number(process.env.PORT ?? 5055);
const storage = getStorage();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use("/api", (req, _res, next) => {
  const organizationId = String(req.header("x-organization-id") || "org-demo-home-services");
  Reflect.set(req, "organizationId", organizationId);
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "businesspulse-ai-api" });
});

app.get("/api/organization", async (_req, res, next) => {
  try {
    const organizations = await storage.getOrganizations();
    res.json(organizations[0]);
  } catch (error) {
    next(error);
  }
});

app.get("/api/uploads", async (req, res, next) => {
  try {
    const data = await storage.getOrgData(org(req));
    res.json(data.uploads);
  } catch (error) {
    next(error);
  }
});

app.post("/api/upload", upload.single("file"), async (req, res, next) => {
  try {
    const body = z.object({ datasetType: z.enum(["customers", "leads", "jobs", "revenue", "marketing_spend"]) }).parse(req.body);
    if (!req.file) throw Object.assign(new Error("CSV file is required"), { status: 400 });
    const organizationId = org(req);
    const data = await storage.getOrgData(organizationId);
    const result = ingestCsv({
      organizationId,
      datasetType: body.datasetType,
      filename: req.file.originalname,
      buffer: req.file.buffer,
      data
    });
    await storage.saveOrgData(organizationId, data);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/metrics", async (req, res, next) => {
  try {
    const period = periodFromQuery(req);
    const organizationId = org(req);
    const data = await storage.getOrgData(organizationId);
    const metrics = calculateMetrics(organizationId, data, period);
    generateAlerts(organizationId, data, metrics);
    generateRecommendations(organizationId, data, metrics);
    await storage.saveOrgData(organizationId, data);
    res.json(metrics);
  } catch (error) {
    next(error);
  }
});

app.post("/api/ask", async (req, res, next) => {
  try {
    const body = z.object({ question: z.string().min(3), start: z.string().optional(), end: z.string().optional() }).parse(req.body);
    const organizationId = org(req);
    const data = await storage.getOrgData(organizationId);
    const period = body.start && body.end ? { start: body.start, end: body.end } : defaultPeriod();
    const metrics = calculateMetrics(organizationId, data, period);
    const answer = await answerQuestion({ organizationId, question: body.question, metrics, data });
    await storage.saveOrgData(organizationId, data);
    res.json(answer);
  } catch (error) {
    next(error);
  }
});

app.post("/api/reports", async (req, res, next) => {
  try {
    const organizationId = org(req);
    const data = await storage.getOrgData(organizationId);
    const metrics = calculateMetrics(organizationId, data, periodFromQuery(req));
    generateRecommendations(organizationId, data, metrics);
    const report = generateReport(organizationId, data, metrics);
    await storage.saveOrgData(organizationId, data);
    res.json(report);
  } catch (error) {
    next(error);
  }
});

app.get("/api/reports", async (req, res, next) => {
  try {
    const data = await storage.getOrgData(org(req));
    res.json(data.reports);
  } catch (error) {
    next(error);
  }
});

app.get("/api/alerts", async (req, res, next) => {
  try {
    const data = await storage.getOrgData(org(req));
    res.json(data.alerts);
  } catch (error) {
    next(error);
  }
});

app.get("/api/recommendations", async (req, res, next) => {
  try {
    const data = await storage.getOrgData(org(req));
    res.json(data.recommendations);
  } catch (error) {
    next(error);
  }
});

app.get("/api/agent-runs", async (req, res, next) => {
  try {
    const data = await storage.getOrgData(org(req));
    res.json(data.agentRuns);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const err = error as { message?: string; status?: number };
  res.status(err.status ?? 500).json({ error: err.message ?? "Unexpected server error" });
});

void (async () => {
  await storage.initialize();
  app.listen(port, () => {
    const mode = process.env.DATABASE_URL ? "postgres" : "memory";
    console.log(`BusinessPulse AI API listening on http://localhost:${port} (${mode} mode)`);
  });
})();

function org(req: express.Request) {
  return String(Reflect.get(req, "organizationId"));
}

function periodFromQuery(req: express.Request) {
  const parsed = z.object({ start: z.string().optional(), end: z.string().optional() }).parse(req.query);
  return parsed.start && parsed.end ? { start: parsed.start, end: parsed.end } : defaultPeriod();
}
