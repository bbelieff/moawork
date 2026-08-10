-- 016_platform_console_metrics_alignment.sql
--
-- Additive alignment for the platform console. 014_platform_metrics_daily.sql
-- remains the canonical storage schema: there is exactly one
-- public.platform_metrics_daily table and its canonical calendar key is `day`
-- (never a parallel `date` column or table).
--
-- The console reads aggregate, metadata-only rows through one RPC. The nightly
-- service rollup continues to use 014's private upsert function; no console
-- caller receives direct table or app_admins access.

-- 014 allowed a platform-only RLS policy but did not need to expose a table
-- contract. Remove that policy and table grants so all interactive reads use
-- the guarded aggregate RPC below.
drop policy if exists platform_metrics_daily_read on public.platform_metrics_daily;
revoke all on table public.platform_metrics_daily from public, anon, authenticated;
revoke all on table public.app_admins from public, anon, authenticated;

-- Do not accept an email, role, workspace, or tenant identifier from the
-- caller. The platform-plane decision is bound only to auth.uid() and the
-- allowlisted app_admins row, which is intentionally not directly selectable.
create or replace function public.platform_console_require_operator()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1
      from auth.users identity
      join public.app_admins administrator
        on lower(administrator.email) = lower(identity.email)
     where identity.id = auth.uid()
       and administrator.is_platform is true
  ) then
    raise exception 'platform operator required' using errcode = '42501';
  end if;
end;
$$;

-- This helper is implementation-only: the public RPC invokes it under the
-- definer owner. Authenticated callers receive no direct execute right.
revoke all on function public.platform_console_require_operator() from public, anon, authenticated;

-- Single platform-console loader contract. It returns daily aggregate values
-- only: no org_id, member/user identity, titles, messages, or activity detail.
-- `day` deliberately matches 014's canonical primary-key column.
create or replace function public.platform_console_metrics_daily(
  p_from date,
  p_to date
)
returns table (
  day date,
  workspace_count integer,
  dau integer,
  mau integer,
  stickiness numeric,
  active_users integer,
  dormant_users integer,
  new_deals integer,
  computed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'valid day range required' using errcode = '22023';
  end if;

  perform public.platform_console_require_operator();

  return query
  select
    metric.day,
    count(*)::integer as workspace_count,
    coalesce(sum(metric.dau), 0)::integer as dau,
    coalesce(sum(metric.mau), 0)::integer as mau,
    case when coalesce(sum(metric.mau), 0) = 0 then 0::numeric
         else round(sum(metric.dau)::numeric / sum(metric.mau)::numeric, 4)
    end as stickiness,
    coalesce(sum(metric.active_users), 0)::integer as active_users,
    coalesce(sum(metric.dormant_users), 0)::integer as dormant_users,
    coalesce(sum(metric.new_deals), 0)::integer as new_deals,
    max(metric.computed_at) as computed_at
  from public.platform_metrics_daily metric
  where metric.day >= p_from
    and metric.day <= p_to
  group by metric.day
  order by metric.day asc;
end;
$$;

revoke all on function public.platform_console_metrics_daily(date, date) from public, anon;
grant execute on function public.platform_console_metrics_daily(date, date) to authenticated;

comment on function public.platform_console_metrics_daily(date, date) is
  'Platform-console aggregate loader. Reads 014 day-keyed rollups only after a security-definer platform guard.';
