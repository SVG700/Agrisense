-- =============================================================================
-- Agrisense AI - schema v4: action log (Sprayed / Released / Not yet)
-- Paste into the Supabase SQL editor and run. Idempotent; adds one table only.
-- (The same block is included in supabase/schema.sql.)
-- =============================================================================
create table if not exists public.trap_actions (
  id         bigint generated always as identity primary key,
  device_id  uuid not null references public.devices (id) on delete cascade,
  action     text not null check (action in ('sprayed', 'released', 'not_yet')),
  -- the advice shown when the farmer acted (context for the log; never trusted for decisions)
  decision   text check (decision in ('SPRAY', 'BIOCONTROL', 'WAIT', 'CHECK_TRAP')),
  note       text check (char_length(note) <= 280),
  acted_at   timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists trap_actions_device_time_idx on public.trap_actions (device_id, acted_at desc);
-- No policies: only the backend (service role) can read or write
alter table public.trap_actions enable row level security;
