# BusinessPulse AI Operations Runbook

This runbook defines baseline monitoring and response procedures for the API.

## Observability Inputs

- Health check: `GET /api/health`
- Operational metrics: `GET /api/ops/metrics` (owner/admin auth required)
- Structured request logs: emitted by API middleware with `requestId`
- Structured error logs: emitted by API error handler with `requestId`

## `/api/ops/metrics` Fields

- `startedAt`: API process start time (ISO)
- `uptimeSeconds`: process uptime
- `requests.total`: total API requests since process start
- `requests.errors5xx`: total 5xx responses since process start
- `requests.byStatusClass`: `2xx/3xx/4xx/5xx` counters
- `activeGuards.loginAttemptBuckets`: active login-rate-limit buckets
- `activeGuards.publicRateLimitBuckets`: active public endpoint rate-limit buckets
- `activeGuards.inFlightWebhookEvents`: currently processing Stripe webhook event ids
- `hottestPaths`: top request volume paths since process start

## Alert Thresholds (Initial)

These are startup thresholds for MVP stage and should be tuned after one week of real traffic.

1. Error ratio (`5xx / total`) over rolling 15 minutes:
   - Warn: `>= 1%`
   - Critical: `>= 3%`
2. Absolute 5xx count over rolling 5 minutes:
   - Warn: `>= 10`
   - Critical: `>= 25`
3. `inFlightWebhookEvents` stuck above `20` for more than `2` minutes:
   - Warn: possible webhook backlog
4. `publicRateLimitBuckets` growth spike:
   - Warn when current value is > 3x 1-hour baseline
5. `loginAttemptBuckets` growth spike:
   - Warn when current value is > 3x 1-hour baseline

## Triage Workflow

1. Confirm service status:
   - check `GET /api/health`
2. Pull `GET /api/ops/metrics` with owner/admin token.
3. For active failures, correlate by `requestId`:
   - from client/API response payload `requestId`
   - into structured logs (`http_request`, `request_failure`)
4. If 5xx elevated:
   - identify hottest failing `path`
   - check recent deploy/change window
   - temporarily disable risky non-core workflow if needed (for example billing/manual sync triggers)
5. If webhook backlog elevated:
   - verify Stripe webhook delivery health
   - inspect duplicate/slow event patterns
   - restart API process only after collecting logs and request ids

## Recovery Checklist

1. Confirm error ratio returns below warn threshold for 15 minutes.
2. Validate main user flow manually:
   - login
   - dashboard metrics load
   - Ask AI request
   - CSV upload preview (if owner/admin)
3. Confirm `hottestPaths` and status class counters normalize.
4. Record incident summary:
   - time window
   - primary symptoms
   - root cause
   - remediation
   - follow-up tasks

## Backup And Restore Drill

For PostgreSQL deployments:

1. Export backup:
   - `./scripts/backup-db.sh`
2. Validate backup file exists under `./backups`.
3. Restore on a non-production database first:
   - `./scripts/restore-db.sh ./backups/<backup-file>.sql.gz`
4. Verify app startup and smoke flows against restored data.

## Data Handling Safety

- Error responses include `requestId`, not raw stack traces.
- Error log sanitizer redacts:
  - email patterns
  - password fields (`password`, `currentPassword`, `nextPassword`)

## Ownership

- Primary: backend/on-call owner
- Secondary: product engineering owner

Update this runbook whenever API routes, auth, webhook behavior, or observability schema changes.
