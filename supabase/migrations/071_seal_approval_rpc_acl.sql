-- BBE-105: close Supabase default function grants on the seal approval RPC.
alter function public.request_deal_seal_approval(uuid, uuid, uuid) owner to postgres;
alter function public.request_deal_seal_approval(uuid, uuid, uuid)
  security definer
  set search_path = public, pg_temp;

revoke all on function public.request_deal_seal_approval(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.request_deal_seal_approval(uuid, uuid, uuid)
  to authenticated;
