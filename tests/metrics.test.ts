import assert from "node:assert/strict";
import { calculateMetrics } from "../server/metrics";
import { getOrgData } from "../server/store";
import { DEMO_ORG_ID, defaultPeriod } from "../server/utils";

const data = getOrgData(DEMO_ORG_ID);
const metrics = calculateMetrics(DEMO_ORG_ID, data, defaultPeriod());

assert.equal(metrics.organizationId, DEMO_ORG_ID);
assert.ok(metrics.cards.some((card) => card.name === "Total revenue"));
assert.ok(metrics.cards.every((card) => card.source.length > 0));
assert.ok(metrics.dataSourcesUsed.includes("revenue"));
assert.equal(metrics.period.start.length, 10);

console.log("metrics.test.ts passed");
