alter table organizations add column if not exists subscription_plan text not null default 'starter';
alter table organizations add column if not exists subscription_status text not null default 'trialing';

create table if not exists public_leads (
  id text primary key,
  email text not null,
  company text,
  phone text,
  source text not null,
  created_at timestamptz not null default now()
);

create table if not exists demo_requests (
  id text primary key,
  name text not null,
  email text not null,
  company text,
  message text,
  created_at timestamptz not null default now()
);

create table if not exists analytics_events (
  id text primary key,
  organization_id text,
  event_name text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists billing_subscriptions (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_checkout_session_id text,
  plan text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_analytics_events_org_name on analytics_events (organization_id, event_name, created_at desc);
create index if not exists idx_public_leads_email on public_leads (email, created_at desc);
