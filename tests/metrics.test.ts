import assert from "node:assert/strict";
import { calculateMetrics } from "../server/metrics";
import type { OrgData } from "../server/store";
import { getOrgData } from "../server/store";
import { DEMO_ORG_ID, defaultPeriod } from "../server/utils";

const data = getOrgData(DEMO_ORG_ID);
const metrics = calculateMetrics(DEMO_ORG_ID, data, defaultPeriod());

assert.equal(metrics.organizationId, DEMO_ORG_ID);
assert.ok(metrics.cards.some((card) => card.name === "Total revenue"));
assert.ok(metrics.cards.every((card) => card.source.length > 0));
assert.ok(metrics.dataSourcesUsed.includes("revenue"));
assert.equal(metrics.period.start.length, 10);

const repeatData: OrgData = {
  customers: [],
  leads: [],
  jobs: [
    {
      id: "job_1",
      organizationId: DEMO_ORG_ID,
      externalId: "J-1",
      customerExternalId: "C-1",
      status: "completed",
      completedAt: "2026-05-10T10:00:00.000Z",
      createdAt: "2026-05-10T10:00:00.000Z",
      updatedAt: "2026-05-10T10:00:00.000Z"
    },
    {
      id: "job_2",
      organizationId: DEMO_ORG_ID,
      externalId: "J-2",
      customerExternalId: "C-1",
      status: "completed",
      completedAt: "2026-05-11T10:00:00.000Z",
      createdAt: "2026-05-11T10:00:00.000Z",
      updatedAt: "2026-05-11T10:00:00.000Z"
    },
    {
      id: "job_3",
      organizationId: DEMO_ORG_ID,
      externalId: "J-3",
      customerExternalId: "C-2",
      status: "completed",
      completedAt: "2026-05-12T10:00:00.000Z",
      createdAt: "2026-05-12T10:00:00.000Z",
      updatedAt: "2026-05-12T10:00:00.000Z"
    }
  ],
  revenue: [
    {
      id: "rev_1",
      organizationId: DEMO_ORG_ID,
      amount: 300,
      paidAt: "2026-05-10T10:00:00.000Z",
      createdAt: "2026-05-10T10:00:00.000Z",
      updatedAt: "2026-05-10T10:00:00.000Z"
    },
    {
      id: "rev_2",
      organizationId: DEMO_ORG_ID,
      amount: 200,
      paidAt: "2026-05-12T10:00:00.000Z",
      createdAt: "2026-05-12T10:00:00.000Z",
      updatedAt: "2026-05-12T10:00:00.000Z"
    }
  ],
  marketingSpend: [],
  dataSources: [],
  uploads: [],
  reports: [],
  alerts: [],
  recommendations: [],
  agentRuns: []
};

const repeatMetrics = calculateMetrics(DEMO_ORG_ID, repeatData, { start: "2026-05-10", end: "2026-05-12" });
const repeatCard = repeatMetrics.cards.find((card) => card.name === "Repeat customer rate");
assert.ok(repeatCard);
assert.equal(repeatCard.formatted, "50.0%");
const totalRevenueCard = repeatMetrics.cards.find((card) => card.name === "Total revenue");
assert.ok(totalRevenueCard);
const bySourceSum = repeatMetrics.revenueByLeadSource.reduce((total, row) => total + row.value, 0);
const byJobTypeSum = repeatMetrics.revenueByJobType.reduce((total, row) => total + row.value, 0);
assert.equal(bySourceSum, totalRevenueCard.value);
assert.equal(byJobTypeSum, totalRevenueCard.value);

console.log("metrics.test.ts passed");
