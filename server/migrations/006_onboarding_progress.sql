create table if not exists onboarding_progress (
  organization_id text primary key references organizations(id) on delete cascade,
  first_upload_at timestamptz,
  core_datasets_completed_at timestamptz,
  updated_at timestamptz not null default now()
);
