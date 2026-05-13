# BusinessPulse AI MVP

BusinessPulse AI is a production-minded MVP for home service companies. It ingests CSV files, normalizes customer, lead, job, revenue, and marketing records, computes deterministic metrics, and answers business questions with source-backed reasoning.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

The API runs on `http://localhost:5055`. AI answers use `OPENAI_API_KEY` when configured and fall back to deterministic grounded analysis when no key is present.

## Persistence Modes

- If `DATABASE_URL` is set, the API runs in PostgreSQL mode and persists tenant state in database tables.
- If `DATABASE_URL` is empty, the API runs in in-memory mode (non-persistent).

Example `DATABASE_URL`:

```text
postgresql://localhost:5432/businesspulse_ai
```

## Auth And Roles

- Login endpoint: `POST /api/auth/login`
- Protected endpoints require `Authorization: Bearer <token>`
- Roles enforced server-side:
  - `owner` and `admin`: write actions (upload, report generation, integration sync)
  - `viewer`: read-only dashboards and Ask AI

Default local demo login:

- Email: `owner@businesspulse.local`
- Password: `demo1234`

## First Live Integration

- Endpoint: `POST /api/integrations/stripe/sync`
- Inputs: optional `secretKey`, optional `limit`
- Behavior: fetches charges from Stripe and ingests them as revenue transactions
- Webhook endpoint: `POST /api/integrations/stripe/webhook`
- Webhook events handled: `payment_intent.succeeded`, `charge.succeeded`, `charge.refunded`

### Stripe Webhook Local Test

1. Set `STRIPE_WEBHOOK_SECRET` in `.env` to your local test secret.
2. Build a test payload JSON with `metadata.organization_id` set to a valid org ID, for example `org-demo-home-services`.
3. Sign and send the payload:

```bash
PAYLOAD='{"type":"payment_intent.succeeded","data":{"object":{"id":"pi_test_123","amount_received":12900,"created":1715600000,"metadata":{"organization_id":"org-demo-home-services"}}}}'
SIG=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$STRIPE_WEBHOOK_SECRET" | sed 's/^.* //')
curl -X POST http://localhost:5055/api/integrations/stripe/webhook \
  -H "Content-Type: application/json" \
  -H "stripe-signature: t=1715600000,v1=$SIG" \
  --data "$PAYLOAD"
```

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
- Tenant isolation guard on protected routes through bearer-token session context
