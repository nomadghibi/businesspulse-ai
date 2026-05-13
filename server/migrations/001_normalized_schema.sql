create table if not exists organizations (
  id text primary key,
  name text not null,
  business_type text not null,
  timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  email text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists organization_members (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null check (role in ('owner','admin','viewer')),
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  organization_id text not null references organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists data_sources (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  payload jsonb not null
);
create table if not exists file_uploads (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  payload jsonb not null
);
create table if not exists customers (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  payload jsonb not null
);
create table if not exists leads (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  payload jsonb not null
);
create table if not exists jobs (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  payload jsonb not null
);
create table if not exists revenue_transactions (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  payload jsonb not null
);
create table if not exists marketing_spend (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  payload jsonb not null
);
create table if not exists reports (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  payload jsonb not null
);
create table if not exists alerts (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  payload jsonb not null
);
create table if not exists recommendations (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  payload jsonb not null
);
create table if not exists agent_runs (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  payload jsonb not null
);
create table if not exists integration_connections (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  provider text not null,
  config jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists schema_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);
