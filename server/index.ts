import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { answerQuestion } from "./ai";
import { ingestCsv } from "./csv";
import { calculateMetrics, generateAlerts, generateRecommendations, generateReport } from "./metrics";
import { getOrgData, getOrganizations } from "./store";
import { defaultPeriod } from "./utils";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const port = Number(process.env.PORT ?? 5055);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use("/api", (req, _res, next) => {
  const organizationId = String(req.header("x-organization-id") || getOrganizations()[0].id);
  Reflect.set(req, "organizationId", organizationId);
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "businesspulse-ai-api" });
});

app.get("/api/organization", (_req, res) => {
  res.json(getOrganizations()[0]);
});

app.get("/api/uploads", (req, res) => {
  const data = getOrgData(org(req));
  res.json(data.uploads);
});

app.post("/api/upload", upload.single("file"), (req, res, next) => {
  try {
    const body = z.object({ datasetType: z.enum(["customers", "leads", "jobs", "revenue", "marketing_spend"]) }).parse(req.body);
    if (!req.file) throw Object.assign(new Error("CSV file is required"), { status: 400 });
    const organizationId = org(req);
    const result = ingestCsv({
      organizationId,
      datasetType: body.datasetType,
      filename: req.file.originalname,
      buffer: req.file.buffer,
      data: getOrgData(organizationId)
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/metrics", (req, res) => {
  const period = periodFromQuery(req);
  const organizationId = org(req);
  const data = getOrgData(organizationId);
  const metrics = calculateMetrics(organizationId, data, period);
  generateAlerts(organizationId, data, metrics);
  generateRecommendations(organizationId, data, metrics);
  res.json(metrics);
});

app.post("/api/ask", async (req, res, next) => {
  try {
    const body = z.object({ question: z.string().min(3), start: z.string().optional(), end: z.string().optional() }).parse(req.body);
    const organizationId = org(req);
    const data = getOrgData(organizationId);
    const period = body.start && body.end ? { start: body.start, end: body.end } : defaultPeriod();
    const metrics = calculateMetrics(organizationId, data, period);
    const answer = await answerQuestion({ organizationId, question: body.question, metrics, data });
    res.json(answer);
  } catch (error) {
    next(error);
  }
});

app.post("/api/reports", (req, res) => {
  const organizationId = org(req);
  const data = getOrgData(organizationId);
  const metrics = calculateMetrics(organizationId, data, periodFromQuery(req));
  generateRecommendations(organizationId, data, metrics);
  res.json(generateReport(organizationId, data, metrics));
});

app.get("/api/reports", (req, res) => {
  res.json(getOrgData(org(req)).reports);
});

app.get("/api/alerts", (req, res) => {
  res.json(getOrgData(org(req)).alerts);
});

app.get("/api/recommendations", (req, res) => {
  res.json(getOrgData(org(req)).recommendations);
});

app.get("/api/agent-runs", (req, res) => {
  res.json(getOrgData(org(req)).agentRuns);
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const err = error as { message?: string; status?: number };
  res.status(err.status ?? 500).json({ error: err.message ?? "Unexpected server error" });
});

app.listen(port, () => {
  console.log(`BusinessPulse AI API listening on http://localhost:${port}`);
});

function org(req: express.Request) {
  return String(Reflect.get(req, "organizationId"));
}

function periodFromQuery(req: express.Request) {
  const parsed = z.object({ start: z.string().optional(), end: z.string().optional() }).parse(req.query);
  return parsed.start && parsed.end ? { start: parsed.start, end: parsed.end } : defaultPeriod();
}
