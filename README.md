# BusinessPulse AI MVP

BusinessPulse AI is a production-minded MVP for home service companies. It ingests CSV files, normalizes customer, lead, job, revenue, and marketing records, computes deterministic metrics, and answers business questions with source-backed reasoning.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

The API runs on `http://localhost:5055`. AI answers use `OPENAI_API_KEY` when configured and fall back to deterministic grounded analysis when no key is present.

## Build And Test

```bash
npm run build
npm test
```

## MVP Scope

- CSV upload with dataset detection, column mapping, validation, and data quality notes
- Organization-scoped in-memory data store shaped for a future PostgreSQL/Drizzle persistence layer
- Metrics dashboard with period comparison, trends, alerts, and recommendations
- Ask AI endpoint with server-side-only model access and audit logging
- Report generation for weekly executive summaries
- Tenant isolation guard on every route through `x-organization-id`
