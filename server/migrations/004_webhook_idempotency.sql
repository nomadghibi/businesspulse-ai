create table if not exists processed_webhook_events (
  id text primary key,
  provider text not null,
  organization_id text,
  event_type text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_processed_webhook_events_provider_created
  on processed_webhook_events (provider, created_at desc);
