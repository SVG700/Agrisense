-- =============================================================================
-- Agrisense AI - Supabase schema (v4: v2 + v3 map + v4 action log)
--
-- Idempotent: safe on a fresh project AND on a project created with the v1
-- schema. It only ADDS columns/constraints/policies; it never drops tables or
-- data. Run it in the Supabase SQL editor (Dashboard -> SQL Editor).
--
-- v2 changes vs v1:
--   * sensor_telemetry.capture_id (unique)  -> idempotent retries from the edge
--   * sensor_telemetry.image_path           -> private storage object path
--   * temperature / humidity are nullable   -> a failed sensor read is NULL, never faked
--   * pest_detections.vision_meta + unique(telemetry_id)
--   * devices.battery_source / battery_updated_at
--   * ingest_capture() RPC                  -> telemetry + detection in ONE transaction
--   * Row Level Security on every table, private storage bucket
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- devices
-- -----------------------------------------------------------------------------
create table if not exists public.devices (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  battery_level integer not null default 100 check (battery_level between 0 and 100),
  status        text not null default 'online',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.devices add column if not exists battery_source text not null default 'unknown';
alter table public.devices add column if not exists battery_updated_at timestamptz;

do $$ begin
  alter table public.devices add constraint devices_status_check
    check (status in ('online', 'low_battery', 'offline'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.devices add constraint devices_battery_source_check
    check (battery_source in ('unknown', 'manual', 'device'));
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- sensor_telemetry
-- -----------------------------------------------------------------------------
create table if not exists public.sensor_telemetry (
  id          bigint generated always as identity primary key,
  device_id   uuid not null references public.devices (id) on delete cascade,
  "timestamp" timestamptz not null default now(),
  temperature double precision,
  humidity    double precision,
  image_url   text
);

alter table public.sensor_telemetry add column if not exists capture_id uuid;
alter table public.sensor_telemetry add column if not exists image_path text;
alter table public.sensor_telemetry add column if not exists received_at timestamptz not null default now();
-- Who produced the readings: hardware (real sensors), simulator / dashboard (mock), unknown (legacy)
alter table public.sensor_telemetry add column if not exists data_source text not null default 'unknown';
alter table public.sensor_telemetry alter column temperature drop not null;
alter table public.sensor_telemetry alter column humidity drop not null;

create unique index if not exists sensor_telemetry_capture_id_key
  on public.sensor_telemetry (capture_id);
create index if not exists sensor_telemetry_device_ts_idx
  on public.sensor_telemetry (device_id, "timestamp" desc);

do $$ begin
  alter table public.sensor_telemetry add constraint sensor_telemetry_temperature_range
    check (temperature is null or temperature between -40 and 85);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.sensor_telemetry add constraint sensor_telemetry_data_source_check
    check (data_source in ('hardware', 'simulator', 'dashboard', 'unknown'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.sensor_telemetry add constraint sensor_telemetry_humidity_range
    check (humidity is null or humidity between 0 and 100);
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- pest_detections
-- -----------------------------------------------------------------------------
create table if not exists public.pest_detections (
  id             bigint generated always as identity primary key,
  telemetry_id   bigint not null references public.sensor_telemetry (id) on delete cascade,
  pest_counts    jsonb not null default '{}'::jsonb,
  bounding_boxes jsonb not null default '[]'::jsonb,
  ai_advisory    jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

-- {status, source, provider, model, image:{width,height}, rejected, error}
alter table public.pest_detections add column if not exists vision_meta jsonb not null default '{}'::jsonb;

drop index if exists public.pest_detections_telemetry_idx;  -- replaced by the unique index below
create unique index if not exists pest_detections_telemetry_id_key
  on public.pest_detections (telemetry_id);

-- -----------------------------------------------------------------------------
-- v3: Pest Surveillance Map
--   * trap coordinates (WGS84) + a simulated flag on devices
--   * trap_daily_observations: one row per trap per day (seeded demo history;
--     real captures are aggregated by the API at query time)
-- -----------------------------------------------------------------------------
alter table public.devices add column if not exists latitude double precision;
alter table public.devices add column if not exists longitude double precision;
alter table public.devices add column if not exists simulated boolean not null default false;

do $$ begin
  alter table public.devices add constraint devices_coordinates_check
    check ((latitude is null and longitude is null)
        or (latitude between -90 and 90 and longitude between -180 and 180));
exception when duplicate_object then null; end $$;

create table if not exists public.trap_daily_observations (
  id             bigint generated always as identity primary key,
  device_id      uuid not null references public.devices (id) on delete cascade,
  date           date not null,
  pest_count     integer not null check (pest_count >= 0),
  predator_count integer not null default 0 check (predator_count >= 0),
  dominant_pest  text,
  decision       text not null check (decision in ('SPRAY', 'BIOCONTROL', 'WAIT')),
  simulated      boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (device_id, date)
);
create index if not exists trap_daily_observations_date_idx on public.trap_daily_observations (date);
alter table public.trap_daily_observations enable row level security;

-- -----------------------------------------------------------------------------
-- v4: action log - what the farmer did after the advice (Sprayed / Released / Not yet)
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- Atomic, idempotent ingestion. Called by the backend with the service role.
-- Returns {telemetry, detection, duplicate}.
-- -----------------------------------------------------------------------------
create or replace function public.ingest_capture(p_telemetry jsonb, p_detection jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tel public.sensor_telemetry;
  v_det public.pest_detections;
  v_dup boolean := false;
begin
  insert into public.sensor_telemetry (device_id, capture_id, "timestamp", temperature, humidity, image_url, image_path, data_source)
  values (
    (p_telemetry->>'device_id')::uuid,
    (p_telemetry->>'capture_id')::uuid,
    (p_telemetry->>'timestamp')::timestamptz,
    (p_telemetry->>'temperature')::double precision,
    (p_telemetry->>'humidity')::double precision,
    p_telemetry->>'image_url',
    p_telemetry->>'image_path',
    coalesce(p_telemetry->>'data_source', 'unknown')
  )
  on conflict (capture_id) do nothing
  returning * into v_tel;

  if v_tel.id is null then
    -- Retry of a capture we already stored: return the original rows untouched
    v_dup := true;
    select * into v_tel from public.sensor_telemetry where capture_id = (p_telemetry->>'capture_id')::uuid;
    select * into v_det from public.pest_detections where telemetry_id = v_tel.id;
  else
    insert into public.pest_detections (telemetry_id, pest_counts, bounding_boxes, ai_advisory, vision_meta)
    values (
      v_tel.id,
      coalesce(p_detection->'pest_counts', '{}'::jsonb),
      coalesce(p_detection->'bounding_boxes', '[]'::jsonb),
      coalesce(p_detection->'ai_advisory', '{}'::jsonb),
      coalesce(p_detection->'vision_meta', '{}'::jsonb)
    )
    returning * into v_det;
  end if;

  return jsonb_build_object('telemetry', to_jsonb(v_tel), 'detection', to_jsonb(v_det), 'duplicate', v_dup);
end;
$$;

revoke all on function public.ingest_capture(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_capture(jsonb, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security: no policies = anon/authenticated roles get NOTHING.
-- The backend uses the service_role key (server-side only), which bypasses RLS.
-- -----------------------------------------------------------------------------
alter table public.devices          enable row level security;
alter table public.sensor_telemetry enable row level security;
alter table public.pest_detections  enable row level security;

-- -----------------------------------------------------------------------------
-- Demo seed: the device the edge simulator posts as by default
-- -----------------------------------------------------------------------------
insert into public.devices (id, name, battery_level, status)
values ('11111111-1111-4111-8111-111111111111', 'Greenhouse A - Trap 01', 92, 'online')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Storage: PRIVATE bucket. The backend uploads with the service role and hands
-- the dashboard short-lived signed URLs (SUPABASE_SIGNED_URL_TTL).
-- NOTE: if a v1 install created this bucket as public, this makes it private.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trap-images', 'trap-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
