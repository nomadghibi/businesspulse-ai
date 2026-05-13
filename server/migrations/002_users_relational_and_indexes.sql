alter table users add column if not exists disabled boolean not null default false;

create table if not exists bp_customers (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  external_id text,
  name text,
  email text,
  phone text,
  city text,
  state text,
  zip text,
  lead_source text,
  first_seen_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists bp_leads (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  external_id text,
  customer_external_id text,
  source text,
  campaign text,
  status text,
  estimated_value numeric,
  created_at_source timestamptz,
  booked_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists bp_jobs (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  external_id text,
  customer_external_id text,
  lead_external_id text,
  job_type text,
  technician text,
  status text,
  scheduled_at timestamptz,
  completed_at timestamptz,
  revenue numeric,
  cost numeric,
  lead_source text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists bp_revenue_transactions (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  external_id text,
  customer_external_id text,
  job_external_id text,
  amount numeric not null,
  payment_method text,
  paid_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists bp_marketing_spend (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  spend_date date not null,
  platform text,
  campaign text,
  impressions integer,
  clicks integer,
  spend numeric not null,
  leads integer,
  conversions integer,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_bp_customers_org_external on bp_customers (organization_id, external_id);
create index if not exists idx_bp_leads_org_created_source on bp_leads (organization_id, created_at_source, source);
create index if not exists idx_bp_jobs_org_completed on bp_jobs (organization_id, completed_at);
create index if not exists idx_bp_revenue_org_paid on bp_revenue_transactions (organization_id, paid_at);
create index if not exists idx_bp_marketing_org_date on bp_marketing_spend (organization_id, spend_date);
