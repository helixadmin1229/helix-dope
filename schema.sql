-- ============================================================
-- DOPE â€” Complete Schema v2
-- Includes: workflows, events, ideas, drill_reports,
--           snapshots, workflow_jobs + all indexes + RLS
-- Run in: Supabase Dashboard â†’ SQL Editor
-- ============================================================

create extension if not exists "pgcrypto";


-- â”€â”€ WORKFLOWS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

create table workflows (
  id          uuid primary key default gen_random_uuid(),
  session_id  text,
  status      text not null default 'running'
              check (status in ('running','completed','failed','paused','aborted')),
  input       jsonb not null default '{}',
  config      jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger workflows_touch
  before update on workflows
  for each row execute procedure touch_updated_at();


-- â”€â”€ WORKFLOW EVENTS (the core â€” append-only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

create table workflow_events (
  id          uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  seq         bigint not null,
  type        text   not null,
  payload     jsonb  not null default '{}',
  source      text   not null default 'system'
              check (source in ('system','llm','human')),
  created_at  timestamptz not null default now(),
  unique (workflow_id, seq)
);

create index workflow_events_workflow_seq on workflow_events (workflow_id, seq);
create index workflow_events_type         on workflow_events (workflow_id, type);

create or replace function assign_event_seq()
returns trigger language plpgsql as $$
begin
  select coalesce(max(seq), -1) + 1 into new.seq
  from workflow_events where workflow_id = new.workflow_id;
  return new;
end;
$$;

create trigger workflow_events_seq
  before insert on workflow_events
  for each row execute procedure assign_event_seq();


-- â”€â”€ IDEAS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

create table ideas (
  id          uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  event_id    uuid not null references workflow_events(id),
  name        text not null,
  tagline     text,
  problem     text,
  target      text,
  gap         text,
  signals     jsonb default '[]',
  tags        jsonb default '[]',
  score       int,
  confidence  int,
  difficulty  text check (difficulty in ('low','medium','high')),
  market_size text check (market_size in ('small','medium','large')),
  lens        text,
  shortlisted boolean not null default false,
  skipped     boolean not null default false,
  decided     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index ideas_workflow on ideas (workflow_id);
create index ideas_lens     on ideas (workflow_id, lens);
create index ideas_tags     on ideas using gin (tags);


-- â”€â”€ DRILL REPORTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

create table drill_reports (
  id              uuid primary key default gen_random_uuid(),
  workflow_id     uuid not null references workflows(id) on delete cascade,
  idea_id         uuid not null references ideas(id) on delete cascade,
  event_id        uuid not null references workflow_events(id),
  verdict         text check (verdict in ('GO','MAYBE','PASS')),
  verdict_reason  text,
  competitors     jsonb default '[]',
  gtm             text,
  tech_risk       text,
  market_risk     text,
  arr_12m         text,
  mvp_weeks       int,
  mvp_team        text,
  mvp_cost        text,
  summary         text,
  created_at      timestamptz not null default now(),
  unique (idea_id)
);


-- â”€â”€ SNAPSHOTS (avoid full replay on long workflows) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

create table workflow_snapshots (
  id           uuid primary key default gen_random_uuid(),
  workflow_id  uuid not null references workflows(id) on delete cascade,
  seq          bigint not null,
  state        jsonb  not null,
  event_count  int    not null,
  created_at   timestamptz default now(),
  unique (workflow_id, seq)
);

create index snapshots_workflow on workflow_snapshots (workflow_id, seq desc);


-- â”€â”€ WORKFLOW JOBS (durable queue) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

create table workflow_jobs (
  id           uuid primary key default gen_random_uuid(),
  workflow_id  uuid not null references workflows(id),
  job_type     text not null
               check (job_type in ('run_workflow','run_lens','run_drill','run_opinion')),
  payload      jsonb not null default '{}',
  status       text not null default 'pending'
               check (status in ('pending','running','completed','failed','dead')),
  attempts     int  not null default 0,
  max_attempts int  not null default 3,
  run_at       timestamptz not null default now(),
  started_at   timestamptz,
  completed_at timestamptz,
  error        text,
  created_at   timestamptz default now()
);

create index jobs_pending on workflow_jobs (status, run_at)
  where status = 'pending';

-- Atomic job claim â€” prevents two workers processing same job
create or replace function claim_next_job()
returns workflow_jobs language plpgsql as $$
declare
  job workflow_jobs;
begin
  select * into job
  from workflow_jobs
  where status = 'pending'
    and run_at <= now()
  order by run_at asc
  limit 1
  for update skip locked;

  if not found then return null; end if;

  update workflow_jobs
  set status = 'running', started_at = now(), attempts = attempts + 1
  where id = job.id;

  return job;
end;
$$;


-- â”€â”€ ROW LEVEL SECURITY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

alter table workflows          enable row level security;
alter table workflow_events    enable row level security;
alter table ideas              enable row level security;
alter table drill_reports      enable row level security;
alter table workflow_snapshots enable row level security;
alter table workflow_jobs      enable row level security;

-- Service role: full access (backend uses service key, never exposed to client)
create policy "svc_workflows"  on workflows          for all using (auth.role() = 'service_role');
create policy "svc_events"     on workflow_events    for all using (auth.role() = 'service_role');
create policy "svc_ideas"      on ideas              for all using (auth.role() = 'service_role');
create policy "svc_drills"     on drill_reports      for all using (auth.role() = 'service_role');
create policy "svc_snapshots"  on workflow_snapshots for all using (auth.role() = 'service_role');
create policy "svc_jobs"       on workflow_jobs      for all using (auth.role() = 'service_role');

-- Anon/authenticated users: read their own session data
create policy "users_read_workflows"
  on workflows for select
  using (session_id = current_setting('request.headers', true)::jsonb->>'x-session-id');

create policy "users_read_events"
  on workflow_events for select
  using (workflow_id in (
    select id from workflows
    where session_id = current_setting('request.headers', true)::jsonb->>'x-session-id'
  ));


-- â”€â”€ REALTIME â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

alter publication supabase_realtime add table workflow_events;
alter publication supabase_realtime add table workflows;
alter publication supabase_realtime add table workflow_jobs;


-- â”€â”€ VIEWS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

create or replace view workflow_summary as
select
  w.id, w.session_id, w.status, w.input, w.config, w.created_at,
  count(distinct i.id)                                        as idea_count,
  count(distinct i.id) filter (where i.shortlisted)          as shortlisted_count,
  count(distinct i.id) filter (where i.decided)              as decided_count,
  count(distinct dr.id)                                       as drill_count,
  count(distinct we.id)                                       as event_count,
  max(we.created_at)                                          as last_event_at
from workflows w
left join ideas i            on i.workflow_id  = w.id
left join drill_reports dr   on dr.workflow_id = w.id
left join workflow_events we on we.workflow_id = w.id
group by w.id;

create or replace view workflow_token_usage as
select
  workflow_id,
  sum((payload->>'tokens')::int)                                  as total_tokens,
  count(*) filter (where type = 'TOOL_INVOKED')                   as total_tool_calls,
  count(*) filter (where type = 'SANDBOX_VIOLATION')              as violations,
  count(*) filter (where type = 'TOOL_FAILED')                    as tool_failures
from workflow_events
where type in ('TOKEN_USAGE','TOOL_INVOKED','SANDBOX_VIOLATION','TOOL_FAILED')
group by workflow_id;

create or replace view queue_health as
select
  status, job_type,
  count(*)                                                        as count,
  avg(extract(epoch from (coalesce(completed_at, now()) - started_at)))
                                                                  as avg_duration_secs,
  max(attempts)                                                   as max_attempts_seen
from workflow_jobs
group by status, job_type
order by status, job_type;
