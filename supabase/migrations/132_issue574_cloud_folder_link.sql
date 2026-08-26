-- moa-migration-guard: logical_key=132_issue574_cloud_folder_link predecessor=131_issue528_item_phone_review_status digest=9c58b77da1dac4b30245016cda53b47e08badd5a95ae725aaa45917df0890f6e foundation=false

select public.begin_guarded_migration(
  p_logical_key => '132_issue574_cloud_folder_link',
  p_file_name => '132_issue574_cloud_folder_link.sql',
  p_file_digest => '9c58b77da1dac4b30245016cda53b47e08badd5a95ae725aaa45917df0890f6e',
  p_expected_predecessor => '131_issue528_item_phone_review_status',
  p_executor => 'DG',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

-- Legacy links remain null. Only the product-owned cloud-folder row receives
-- this role, so arbitrary links and uploaded files are never rewritten.
alter table public.board_item_detail_links
  add column if not exists link_kind text
  check (link_kind is null or link_kind = 'cloud_folder');

create unique index if not exists board_item_detail_links_one_cloud_folder
  on public.board_item_detail_links(org_id, board_id, item_id)
  where link_kind = 'cloud_folder';

create table if not exists public.board_item_cloud_folder_requests (
  org_id uuid not null references public.orgs(id),
  request_id uuid not null,
  board_id uuid not null references public.boards(id),
  item_id uuid not null references public.items(id),
  actor_id uuid not null references public.users(id),
  operation text not null check (operation in ('set', 'remove')),
  url text,
  created_at timestamptz not null default now(),
  primary key (org_id, request_id),
  check ((operation = 'set' and url is not null) or (operation = 'remove' and url is null))
);

alter table public.board_item_cloud_folder_requests enable row level security;
alter table public.board_item_cloud_folder_requests force row level security;
revoke all on public.board_item_cloud_folder_requests from public, anon, authenticated, service_role;

create or replace function public.decode_cloud_folder_url(p_url text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_input text := p_url;
  v_output text;
  v_bytes bytea;
  v_index integer;
  v_character text;
  v_hex text;
  v_pass integer;
begin
  if p_url is null then
    return null;
  end if;
  for v_pass in 1..2 loop
    v_bytes := ''::bytea;
    v_index := 1;
    while v_index <= pg_catalog.length(v_input) loop
      v_character := pg_catalog.substr(v_input, v_index, 1);
      if v_character = '%' then
        v_hex := pg_catalog.substr(v_input, v_index + 1, 2);
        if pg_catalog.length(v_hex) <> 2 or v_hex !~ '^[0-9A-Fa-f]{2}$' then
          return null;
        end if;
        v_bytes := v_bytes || pg_catalog.decode(v_hex, 'hex');
        v_index := v_index + 3;
      else
        v_bytes := v_bytes || pg_catalog.convert_to(v_character, 'UTF8');
        v_index := v_index + 1;
      end if;
    end loop;
    v_output := pg_catalog.convert_from(v_bytes, 'UTF8');
    if v_output = v_input then
      return v_output;
    end if;
    v_input := v_output;
  end loop;
  return v_input;
exception when others then
  return null;
end
$$;

revoke all on function public.decode_cloud_folder_url(text) from public, anon, authenticated, service_role;

create or replace function public.is_cloud_folder_url(p_url text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    length(coalesce(p_url, '')) between 10 and 2048
    and decoded_url is not null
    and decoded_url ~ '^https://[^[:space:]/?#]+(?::[0-9]+)?(?:/|$)'
    and decoded_url !~ '^https://[^/?#]*@'
    and decoded_url !~ '[[:cntrl:]]'
    and decoded_url !~* '\.(?:pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|png|jpe?g|gif|webp|mp3|mp4|mov)(?:[?&#/]|$)'
    and decoded_url !~* '[?&](?:id|folder|folder_id|folderId|directory)=[+[:space:]]*(?:&|#|$)'
    and (
      decoded_url ~* '^https://drive\.google\.com/drive/(?:u/[0-9]+/)?folders/[^/?#]*[^[:space:]/?#][^/?#]*(?:[/?#]|$)'
      or decoded_url ~* '^https://(?:[^/]+\.)?1drv\.ms/(?:[^/?#]*:f:[^/?#]*|f)/[^/?#]*[^[:space:]/?#][^/?#]*(?:[/?#]|$)'
      or decoded_url ~* '^https://(?:[^/]+\.)?onedrive\.live\.com/.*(?::f:[^/?#]*/[^/?#]*[^[:space:]/?#][^/?#]*(?:[/?#]|$)|[?&]id=[^&#]*[^[:space:]&#][^&#]*(?:&|#|$))'
      or decoded_url ~* '^https://[^/]+\.sharepoint\.com/.*(?::f:[^/?#]*/[^/?#]*[^[:space:]/?#][^/?#]*(?:[/?#]|$)|/Forms/AllItems\.aspx[^#]*[?&]id=[^&#]*[^[:space:]&#][^&#]*(?:&|#|$))'
      or decoded_url ~* '^https://(?:www\.)?dropbox\.com/(?:scl/fo|sh|home)/[^/?#]*[^[:space:]/?#][^/?#]*(?:[/?#]|$)'
      or (
        decoded_url !~* '^https://(?:drive\.google\.com|(?:[^/]+\.)?1drv\.ms|(?:[^/]+\.)?onedrive\.live\.com|[^/]+\.sharepoint\.com|(?:www\.)?dropbox\.com)(?:/|$)'
        and (
          decoded_url ~* '^https://[^/?#]+/(?:[^?#]*/)?(?:folders?|directories?)/[^/?#]*[^[:space:]/?#][^/?#]*(?:[/?#]|$)'
          or decoded_url ~* '^https://[^/?#]+/.*[?&](?:folder|folder_id|folderId|directory)=[^&#]*[^[:space:]&#][^&#]*(?:&|#|$)'
        )
      )
    )
  from (select public.decode_cloud_folder_url(p_url) decoded_url) decoded
$$;

revoke all on function public.is_cloud_folder_url(text) from public, anon, authenticated, service_role;

create or replace function public.set_board_item_cloud_folder(
  p_org_id uuid,
  p_board_id uuid,
  p_item_id uuid,
  p_url text,
  p_request_id uuid
)
returns table(link_id uuid, operation text, url text, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_operation text := case when p_url is null then 'remove' else 'set' end;
  v_url text := case when p_url is null then null else btrim(p_url) end;
  v_request public.board_item_cloud_folder_requests;
  v_link public.board_item_detail_links;
begin
  if v_actor is null or not public.effective_permission(p_org_id, 'work.item_upsert') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'invalid_request_id' using errcode = '22023';
  end if;
  if v_operation = 'set' and not public.is_cloud_folder_url(v_url) then
    raise exception 'invalid_cloud_folder_url' using errcode = '22023';
  end if;
  if not exists (
    select 1
      from public.items item
      join public.boards board
        on board.id = item.board_id and board.org_id = item.org_id
      join public.org_members member
        on member.org_id = item.org_id
       and member.user_id = v_actor
       and member.status = 'active'
     where item.id = p_item_id
       and item.org_id = p_org_id
       and item.board_id = p_board_id
       and item.deleted_at is null
       and (
         member.role in ('owner', 'admin')
         or member.scope = 'all'
         or item.assigned_to = v_actor
       )
  ) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':' || p_item_id::text || ':cloud-folder', 0)
  );

  select * into v_request
    from public.board_item_cloud_folder_requests request_row
   where request_row.org_id = p_org_id
     and request_row.request_id = p_request_id;
  if found then
    if v_request.board_id <> p_board_id
      or v_request.item_id <> p_item_id
      or v_request.actor_id <> v_actor
      or v_request.operation <> v_operation
      or v_request.url is distinct from v_url then
      raise exception 'request_replay_conflict' using errcode = '23505';
    end if;
    select * into v_link
      from public.board_item_detail_links link_row
     where link_row.org_id = p_org_id
       and link_row.board_id = p_board_id
       and link_row.item_id = p_item_id
       and link_row.link_kind = 'cloud_folder';
    return query select v_link.id, v_operation, v_link.url, true;
    return;
  end if;

  if v_operation = 'remove' then
    delete from public.board_item_detail_links link_row
     where link_row.org_id = p_org_id
       and link_row.board_id = p_board_id
       and link_row.item_id = p_item_id
       and link_row.link_kind = 'cloud_folder';
  else
    insert into public.board_item_detail_links(
      org_id, board_id, item_id, created_by, label, url, request_id, created_at, link_kind
    ) values (
      p_org_id, p_board_id, p_item_id, v_actor, '클라우드 폴더', v_url, p_request_id, now(), 'cloud_folder'
    )
    on conflict (org_id, board_id, item_id) where link_kind = 'cloud_folder'
    do update set
      created_by = excluded.created_by,
      label = excluded.label,
      url = excluded.url,
      request_id = excluded.request_id,
      created_at = excluded.created_at
    returning * into v_link;
  end if;

  insert into public.board_item_cloud_folder_requests(
    org_id, request_id, board_id, item_id, actor_id, operation, url
  ) values (
    p_org_id, p_request_id, p_board_id, p_item_id, v_actor, v_operation, v_url
  );

  return query select v_link.id, v_operation, v_link.url, false;
end;
$$;

revoke all on function public.set_board_item_cloud_folder(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.set_board_item_cloud_folder(uuid, uuid, uuid, text, uuid)
  to authenticated;

do $$
begin
  if exists (
    select 1
      from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name in ('is_cloud_folder_url', 'set_board_item_cloud_folder')
       and grantee in ('PUBLIC', 'anon', 'service_role')
  ) then
    raise exception 'unsafe_issue574_rpc_acl';
  end if;
end;
$$;
