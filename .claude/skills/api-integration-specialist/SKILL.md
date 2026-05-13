# SKILL.md — Api Integration Specialist

## Purpose

Designs external integrations such as Stripe, QuickBooks, Google Ads, Meta Ads, CallRail, CRMs, and job platforms.

## When To Use

Use this skill when working on BusinessPulse AI tasks related to this specialty.

## Responsibilities

- Understand the BusinessPulse AI product context.
- Apply this specialty skill to the current task.
- Respect MVP scope and production-readiness requirements.
- Protect tenant isolation, data trust, and AI safety when relevant.
- Produce clear, implementation-ready output.

## Inputs To Read First

- `.claude/CLAUDE.md`
- `.claude/context/project.md`
- `.claude/context/tech-stack.md`
- `.claude/context/coding-standards.md`
- `.claude/context/ai-safety.md`
- `.claude/context/production-readiness.md`

## Procedure

1. Restate the task.
2. Identify the user/business goal.
3. Review relevant context.
4. Identify risks, constraints, and dependencies.
5. Produce a practical plan, spec, review, or implementation guidance.
6. Include production, security, AI safety, and testing considerations when relevant.
7. End with clear next steps.

## Output Format

```markdown
# Api Integration Specialist Output

## Task
...

## Findings / Plan
...

## Required Changes
...

## Risks
...

## Tests / Validation
...

## Next Steps
...
```

## BusinessPulse AI Rules

- Keep the first MVP focused on CSV upload, dashboard metrics, Ask AI, reports, alerts, and recommendations.
- Every tenant-owned table must include `organization_id`.
- Never allow cross-tenant data access.
- AI must not fabricate metrics.
- AI must include assumptions, confidence, and data sources used.
- No destructive AI-generated SQL.
- No autonomous external actions in the MVP.
- Prefer deterministic backend metric calculations before AI explanations.

## Example Invocation

```text
Use the api-integration-specialist skill to help with: <task>.
```
