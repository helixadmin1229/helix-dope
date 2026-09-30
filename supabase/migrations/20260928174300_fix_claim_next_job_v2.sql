drop function if exists public.claim_next_job();

create function public.claim_next_job()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.workflow_jobs;
begin
  update public.workflow_jobs
  set
    status = 'running',
    started_at = now(),
    attempts = attempts + 1
  where id = (
    select id
    from public.workflow_jobs
    where status = 'pending'
      and run_at <= now()
    order by run_at asc
    limit 1
    for update
  )
  returning * into job;

  if not found then
    return null;
  end if;

  return to_jsonb(job);
end;
$$;
