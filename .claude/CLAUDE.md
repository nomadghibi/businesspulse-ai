# CLAUDE.md — BusinessPulse AI

BusinessPulse AI is an AI Business Analyst platform for home service companies.

## MVP

- Auth and organization workspace
- CSV upload for customers, leads, jobs, revenue, and marketing spend
- Column mapping and data validation
- Metrics dashboard
- Ask AI natural-language analysis
- Executive summaries
- Anomaly alerts
- Recommendations
- Agent run history
- Tenant isolation and audit logs

## Non-Negotiables

- Every tenant-owned table must include organization_id.
- AI must not fabricate numbers.
- AI must cite data sources used.
- AI must include assumptions and confidence.
- AI must not run destructive SQL.
- File uploads must be private.
- Build one vertical slice at a time.
