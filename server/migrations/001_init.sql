-- Initial schema. Deliberately MSAL-ready: user_id columns exist (nullable)
-- so switching on per-user isolation later needs no restructuring.

create extension if not exists pgcrypto;

create table if not exists workpapers (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid,                              -- future: owner
  stakeholder      text not null,
  entity_name      text not null,
  entity_client_id text not null unique,              -- the store's Entity.id
  state_json       jsonb not null,
  version          int  not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists documents (
  id             uuid primary key default gen_random_uuid(),
  workpaper_id   uuid not null references workpapers(id) on delete cascade,
  client_file_id text not null,                       -- EntityFile.id
  filename       text not null,
  size_bytes     bigint not null,
  content_type   text,
  bytes          bytea not null,
  uploaded_at    timestamptz not null default now(),
  unique (workpaper_id, client_file_id)
);

create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  task_no      bigint generated always as identity,
  client       text not null,
  sub_client   text not null,
  return_type  text not null default '5471',
  tax_year     int,
  assignee_name text,                                 -- plain label until login lands
  assignee_id  uuid,                                  -- future: users fk
  status       text not null default 'pending'
               check (status in ('pending','in_progress','completed')),
  workpaper_id uuid references workpapers(id) on delete set null,
  due_date     date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists tasks_status_idx on tasks (status);

create table if not exists audit_events (
  id              bigint generated always as identity primary key,
  workpaper_id    uuid references workpapers(id) on delete set null,
  client_event_id text,
  at              timestamptz not null,
  actor           text not null,
  entity          text,
  action          text not null,
  detail          text not null,
  unique (workpaper_id, client_event_id)
);

create table if not exists settings (
  user_id uuid,                                       -- null = global
  key     text not null,
  value   jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);
