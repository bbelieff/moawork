-- moa-migration-guard: logical_key=132_issue574_cloud_folder_link predecessor=131_issue528_item_phone_review_status digest=5c42474ae9c13eab370ad5f23c0440ddb2593b8db76bb1643a4c8a7c2085b7ad foundation=false

select public.begin_guarded_migration(
  p_logical_key => '132_issue574_cloud_folder_link',
  p_file_name => '132_issue574_cloud_folder_link.sql',
  p_file_digest => '5c42474ae9c13eab370ad5f23c0440ddb2593b8db76bb1643a4c8a7c2085b7ad',
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
  provider text,
  folder_ref text,
  url text,
  created_at timestamptz not null default now(),
  primary key (org_id, request_id),
  check (
    (operation = 'set' and provider is not null and folder_ref is not null and url is not null)
    or (operation = 'remove' and provider is null and folder_ref is null and url is null)
  )
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
  for v_pass in 1..16 loop
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
  -- A URL capped at 2048 characters cannot contain sixteen complete layers
  -- of percent encoding. A remaining escape is therefore an unsafe or
  -- malformed identifier, not a value to store for later interpretation.
  if v_input ~ '%[0-9A-Fa-f]{2}' then
    return null;
  end if;
  return v_input;
exception when others then
  return null;
end
$$;

revoke all on function public.decode_cloud_folder_url(text) from public, anon, authenticated, service_role;

create or replace function public.decode_cloud_folder_query_key_once(p_value text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_input text := pg_catalog.replace(p_value, '+', ' ');
  v_bytes bytea := ''::bytea;
  v_index integer := 1;
  v_character text;
  v_hex text;
begin
  if p_value is null then
    return null;
  end if;
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
  return pg_catalog.convert_from(v_bytes, 'UTF8');
exception when others then
  return null;
end
$$;

revoke all on function public.decode_cloud_folder_query_key_once(text) from public, anon, authenticated, service_role;

create or replace function public.is_cloud_folder_identifier(p_value text, p_query_value boolean default false)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_decoded text;
  v_trimmed text;
  v_trim_chars text := E' \t\n\r\v\f'
    || pg_catalog.chr(160) || pg_catalog.chr(5760)
    || pg_catalog.chr(8192) || pg_catalog.chr(8193) || pg_catalog.chr(8194)
    || pg_catalog.chr(8195) || pg_catalog.chr(8196) || pg_catalog.chr(8197)
    || pg_catalog.chr(8198) || pg_catalog.chr(8199) || pg_catalog.chr(8200)
    || pg_catalog.chr(8201) || pg_catalog.chr(8202)
    || pg_catalog.chr(8232) || pg_catalog.chr(8233) || pg_catalog.chr(8239)
    || pg_catalog.chr(8287) || pg_catalog.chr(12288) || pg_catalog.chr(65279);
begin
  v_decoded := public.decode_cloud_folder_url(
    case when p_query_value then pg_catalog.replace(p_value, '+', ' ') else p_value end
  );
  if v_decoded is null or v_decoded ~ '[[:cntrl:]]' then
    return false;
  end if;
  v_trimmed := pg_catalog.btrim(v_decoded, v_trim_chars);
  return v_trimmed <> ''
    and v_trimmed not in ('.', '..')
    and pg_catalog.btrim(pg_catalog.split_part(pg_catalog.split_part(v_trimmed, '?', 1), '#', 1), v_trim_chars)
      !~* '\.(?:pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|png|jpe?g|gif|webp|mp3|mp4|mov)$';
end
$$;

revoke all on function public.is_cloud_folder_identifier(text, boolean) from public, anon, authenticated, service_role;

create or replace function public.has_cloud_folder_query_identifier(p_query text, p_key text)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_pairs text[];
  v_pair text;
  v_raw_key text;
  v_raw_value text;
  v_decoded_key text;
begin
  if p_query is null then
    return false;
  end if;

  v_pairs := pg_catalog.regexp_split_to_array(p_query, '&');
  foreach v_pair in array v_pairs loop
    v_raw_key := case when pg_catalog.strpos(v_pair, '=') > 0
      then pg_catalog.substr(v_pair, 1, pg_catalog.strpos(v_pair, '=') - 1)
      else v_pair
    end;
    v_raw_value := case when pg_catalog.strpos(v_pair, '=') > 0
      then pg_catalog.substr(v_pair, pg_catalog.strpos(v_pair, '=') + 1)
      else ''
    end;
    v_decoded_key := public.decode_cloud_folder_query_key_once(v_raw_key);
    if v_decoded_key = p_key then
      return public.is_cloud_folder_identifier(v_raw_value, true);
    end if;
  end loop;

  return false;
end
$$;

revoke all on function public.has_cloud_folder_query_identifier(text, text) from public, anon, authenticated, service_role;

create or replace function public.is_cloud_folder_url(p_url text)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_without_fragment text;
  v_before_query text;
  v_query text;
  v_authority text;
  v_host text;
  v_port_text text;
  v_path text;
  v_raw_segments text[];
  v_raw_segment text;
  v_decoded_segment text;
  v_segments text[] := array[]::text[];
  v_segment_count integer;
  v_index integer;
  v_marker_index integer := 0;
  v_generic_folder boolean := false;
  v_js_whitespace text := E' \t\n\r\v\f'
    || pg_catalog.chr(160) || pg_catalog.chr(5760)
    || pg_catalog.chr(8192) || pg_catalog.chr(8193) || pg_catalog.chr(8194)
    || pg_catalog.chr(8195) || pg_catalog.chr(8196) || pg_catalog.chr(8197)
    || pg_catalog.chr(8198) || pg_catalog.chr(8199) || pg_catalog.chr(8200)
    || pg_catalog.chr(8201) || pg_catalog.chr(8202)
    || pg_catalog.chr(8232) || pg_catalog.chr(8233) || pg_catalog.chr(8239)
    || pg_catalog.chr(8287) || pg_catalog.chr(12288) || pg_catalog.chr(65279);
begin
  if p_url is null
     or pg_catalog.length(p_url) not between 10 and 2048
     or p_url ~ '[[:space:]]'
     or p_url <> pg_catalog.translate(p_url, v_js_whitespace, '')
     or p_url ~ '\\'
     or p_url !~* '^https://' then
    return false;
  end if;

  v_without_fragment := pg_catalog.split_part(p_url, '#', 1);
  v_before_query := pg_catalog.split_part(v_without_fragment, '?', 1);
  v_query := case when pg_catalog.strpos(v_without_fragment, '?') > 0
    then pg_catalog.substr(v_without_fragment, pg_catalog.strpos(v_without_fragment, '?') + 1)
    else null
  end;
  v_authority := (pg_catalog.regexp_match(v_before_query, '(?i)^https://([^/?#]+)'))[1];
  if v_authority is null or v_authority ~ '@' then
    return false;
  end if;
  v_host := (pg_catalog.regexp_match(v_authority, '^([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::[0-9]{1,5})?$'))[1];
  v_port_text := (pg_catalog.regexp_match(v_authority, ':([0-9]{1,5})$'))[1];
  if v_host is null or (v_port_text is not null and v_port_text::integer not between 0 and 65535) then
    return false;
  end if;
  v_host := pg_catalog.lower(v_host);
  v_path := pg_catalog.regexp_replace(v_before_query, '(?i)^https://[^/?#]+', '');

  v_raw_segments := pg_catalog.regexp_split_to_array(v_path, '/');
  foreach v_raw_segment in array v_raw_segments loop
    if v_raw_segment = '' then
      continue;
    end if;
    v_decoded_segment := public.decode_cloud_folder_url(v_raw_segment);
    if v_decoded_segment is null
       or v_decoded_segment ~ '[[:cntrl:]]'
       or v_decoded_segment in ('.', '..') then
      return false;
    end if;
    v_segments := pg_catalog.array_append(v_segments, v_decoded_segment);
  end loop;
  v_segment_count := coalesce(pg_catalog.array_length(v_segments, 1), 0);

  if v_host = 'drive.google.com' then
    return (
      v_segment_count >= 3
      and v_segments[1] = 'drive'
      and v_segments[2] = 'folders'
      and public.is_cloud_folder_identifier(v_segments[3], false)
      and public.is_cloud_folder_identifier(v_segments[v_segment_count], false)
    ) or (
      v_segment_count >= 5
      and v_segments[1] = 'drive'
      and v_segments[2] = 'u'
      and v_segments[3] ~ '^[0-9]+$'
      and v_segments[4] = 'folders'
      and public.is_cloud_folder_identifier(v_segments[5], false)
      and public.is_cloud_folder_identifier(v_segments[v_segment_count], false)
    );
  end if;

  for v_index in 1..v_segment_count loop
    if pg_catalog.strpos(pg_catalog.lower(v_segments[v_index]), ':f:') > 0 then
      v_marker_index := v_index;
      exit;
    end if;
  end loop;

  if v_host = '1drv.ms' then
    return v_segment_count >= 2
      and (pg_catalog.strpos(pg_catalog.lower(v_segments[1]), ':f:') > 0 or pg_catalog.lower(v_segments[1]) = 'f')
      and public.is_cloud_folder_identifier(v_segments[v_segment_count], false);
  end if;

  if v_host = 'onedrive.live.com' or v_host like '%.onedrive.live.com' then
    return (
      v_marker_index > 0
      and v_marker_index < v_segment_count
      and public.is_cloud_folder_identifier(v_segments[v_segment_count], false)
    ) or public.has_cloud_folder_query_identifier(v_query, 'id');
  end if;

  if v_host like '%.sharepoint.com' then
    return (
      v_marker_index > 0
      and v_marker_index < v_segment_count
      and public.is_cloud_folder_identifier(v_segments[v_segment_count], false)
    ) or (
      pg_catalog.lower(v_path) like '%/forms/allitems.aspx'
      and public.has_cloud_folder_query_identifier(v_query, 'id')
    );
  end if;

  if v_host in ('dropbox.com', 'www.dropbox.com') then
    return v_segment_count >= 2
      and (
        (v_segments[1] = 'scl' and v_segments[2] = 'fo' and v_segment_count >= 3)
        or v_segments[1] in ('sh', 'home')
      )
      and public.is_cloud_folder_identifier(v_segments[v_segment_count], false);
  end if;

  for v_index in 1..v_segment_count loop
    if pg_catalog.lower(v_segments[v_index]) in ('folder', 'folders', 'directory', 'directories')
       and v_index < v_segment_count
       and public.is_cloud_folder_identifier(v_segments[v_index + 1], false)
       and public.is_cloud_folder_identifier(v_segments[v_segment_count], false) then
      v_generic_folder := true;
      exit;
    end if;
  end loop;

  return v_generic_folder
    or public.has_cloud_folder_query_identifier(v_query, 'folder')
    or public.has_cloud_folder_query_identifier(v_query, 'folder_id')
    or public.has_cloud_folder_query_identifier(v_query, 'folderId')
    or public.has_cloud_folder_query_identifier(v_query, 'directory');
end
$$;

revoke all on function public.is_cloud_folder_url(text) from public, anon, authenticated, service_role;

-- The authenticated boundary never receives a URL. The application parses a
-- provider-owned share shape into a narrow reference, and this private helper
-- reconstructs the only URL that may be persisted.
create or replace function public.canonical_cloud_folder_url(p_provider text, p_folder_ref text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_match text[];
  v_url text;
begin
  if p_provider is null or p_folder_ref is null or pg_catalog.length(p_folder_ref) > 1500 then
    return null;
  end if;
  if p_provider = 'google_drive'
     and pg_catalog.length(p_folder_ref) between 3 and 256
     and p_folder_ref ~ '^[A-Za-z0-9_-]+$' then
    v_url := 'https://drive.google.com/drive/folders/' || p_folder_ref;
  elsif p_provider = 'onedrive'
        and pg_catalog.length(p_folder_ref) between 9 and 518
        and p_folder_ref ~ '^short:[A-Za-z0-9!_-]+$' then
    v_url := 'https://1drv.ms/f/' || pg_catalog.substr(p_folder_ref, 7);
  elsif p_provider = 'onedrive'
        and p_folder_ref ~ '^live:[A-Za-z0-9!_-]+:[A-Za-z0-9_-]+$' then
    v_match := pg_catalog.regexp_match(p_folder_ref, '^live:([A-Za-z0-9!_-]+):([A-Za-z0-9_-]+)$');
    if pg_catalog.length(v_match[1]) > 512 or pg_catalog.length(v_match[2]) > 256 then
      return null;
    end if;
    v_url := 'https://onedrive.live.com/?id=' || v_match[1] || '&cid=' || v_match[2];
  elsif p_provider = 'onedrive'
        and p_folder_ref ~ '^sharepoint\|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\|:f:/[A-Za-z0-9._!~-]+(?:/[A-Za-z0-9._!~-]+)*$'
        and p_folder_ref !~ '(^|/)\.{1,2}(/|$)'
        and p_folder_ref !~* '\.(?:pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|png|jpe?g|gif|webp|mp3|mp4|mov)$' then
    v_match := pg_catalog.regexp_match(p_folder_ref, '^sharepoint\|([^|]+)\|(.+)$');
    v_url := 'https://' || v_match[1] || '.sharepoint.com/' || v_match[2];
  elsif p_provider = 'dropbox'
        and p_folder_ref ~ '^(?:scl/fo|sh|home)/[A-Za-z0-9._!~-]+(?:/[A-Za-z0-9._!~-]+)*$'
        and p_folder_ref !~ '(^|/)\.{1,2}(/|$)'
        and p_folder_ref !~* '\.(?:pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|png|jpe?g|gif|webp|mp3|mp4|mov)$' then
    v_url := 'https://www.dropbox.com/' || p_folder_ref;
  else
    return null;
  end if;

  return case when pg_catalog.length(v_url) <= 2048 then v_url else null end;
end
$$;

revoke all on function public.canonical_cloud_folder_url(text, text) from public, anon, authenticated, service_role;

-- Remove the provisional raw-URL parsing surface. Only the provider/reference
-- canonicalizer above remains after this migration commits.
drop function public.is_cloud_folder_url(text);
drop function public.has_cloud_folder_query_identifier(text, text);
drop function public.is_cloud_folder_identifier(text, boolean);
drop function public.decode_cloud_folder_query_key_once(text);
drop function public.decode_cloud_folder_url(text);

create or replace function public.set_board_item_cloud_folder(
  p_org_id uuid,
  p_board_id uuid,
  p_item_id uuid,
  p_provider text,
  p_folder_ref text,
  p_request_id uuid
)
returns table(link_id uuid, operation text, url text, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_operation text := case when p_provider is null and p_folder_ref is null then 'remove' else 'set' end;
  v_url text := public.canonical_cloud_folder_url(p_provider, p_folder_ref);
  v_request public.board_item_cloud_folder_requests;
  v_link public.board_item_detail_links;
begin
  if v_actor is null or not public.effective_permission(p_org_id, 'work.item_upsert') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'invalid_request_id' using errcode = '22023';
  end if;
  if (p_provider is null) <> (p_folder_ref is null)
     or (v_operation = 'set' and v_url is null) then
    raise exception 'invalid_cloud_folder_reference' using errcode = '22023';
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
      or v_request.provider is distinct from p_provider
      or v_request.folder_ref is distinct from p_folder_ref
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
    org_id, request_id, board_id, item_id, actor_id, operation, provider, folder_ref, url
  ) values (
    p_org_id, p_request_id, p_board_id, p_item_id, v_actor, v_operation, p_provider, p_folder_ref, v_url
  );

  return query select v_link.id, v_operation, v_link.url, false;
end;
$$;

revoke all on function public.set_board_item_cloud_folder(uuid, uuid, uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.set_board_item_cloud_folder(uuid, uuid, uuid, text, text, uuid)
  to authenticated;

do $$
begin
  if exists (
    select 1
      from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name in ('canonical_cloud_folder_url', 'set_board_item_cloud_folder')
       and grantee in ('PUBLIC', 'anon', 'service_role')
  ) then
    raise exception 'unsafe_issue574_rpc_acl';
  end if;
end;
$$;
