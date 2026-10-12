-- moa-migration-guard: logical_key=172_row_move_own_assigned_rows predecessor=171_restore_deal_reassign_and_comment_edit digest=c03e1daf2705e6c3eb6a5eba472bef7e96df50a4582f5bc28dec24105a41786c foundation=false

select public.begin_guarded_migration(
  p_logical_key => '172_row_move_own_assigned_rows',
  p_file_name => '172_row_move_own_assigned_rows.sql',
  p_file_digest => 'c03e1daf2705e6c3eb6a5eba472bef7e96df50a4582f5bc28dec24105a41786c',
  p_expected_predecessor => '171_restore_deal_reassign_and_comment_edit',
  p_executor => 'DC',
  p_thread_id => '9ffa2331-f8b8-46fc-9b09-6375b2e85f6c',
  p_foundation => false
);

-- Issue 883 (belie 결정 2026-10-12) — «본인 담당» 직원이 자기가 맡은 행의 단계를 바꿀 수 있게 한다.
--
--   단계(진행현황)를 바꾸면 행이 다른 그룹으로 옮겨진다(move_board_row_atomic). 이 함수는 대표·관리자·전체 범위만
--   허용해서, 본인 담당 직원은 자기 리드인데도 «통화완료»·«거절» 로 바꿀 수 없었다.
--   이제 «옮기는 행의 담당자가 본인» 이고, 끼워 넣을 기준 행이 없거나 그 기준 행도 본인 담당이면 허용한다.
--   남의 행·남의 행 앞으로 끼워 넣기는 예전처럼 막는다. 항목 추가·수정 권한(work.item_upsert)은 그대로 요구한다.
--
--   이 함수는 행 순서 쓰기 전용 역할(moawork_row_order_writer)이 소유한다(153·158). 158 과 같은 방식으로
--   운영의 현재 정의를 읽어 «권한 검사 한 덩어리» 만 바꿔 같은 역할로 다시 만들고, 소유자·권한·설정·나머지
--   본문이 그대로인지 확인한다. 바꿀 덩어리가 정확히 한 번 나오지 않으면 아무것도 바꾸지 않고 멈춘다.

do $own_rows$
declare
  v_oid oid := 'public.move_board_row_atomic(uuid,uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure::oid;
  v_writer oid := 'moawork_row_order_writer'::regrole::oid;
  v_before jsonb; v_after jsonb; v_members jsonb;
  v_create boolean;
  v_definition text; v_source text; v_new_source text;
  v_old_gate text :=
'  if v_role is null or not public.effective_permission(p_org_id,''work.item_upsert'')
     or not (v_role in (''owner'',''admin'') or v_scope=''all'') then
    raise exception ''row move permission denied'' using errcode=''42501'';
  end if;';
  v_new_gate text :=
'  if v_role is null or not public.effective_permission(p_org_id,''work.item_upsert'')
     or not (v_role in (''owner'',''admin'') or v_scope=''all''
       or (exists(select 1 from public.items oi where oi.id=p_item_id and oi.org_id=p_org_id and oi.board_id=p_board_id
                    and oi.assigned_to=v_actor and oi.deleted_at is null and oi.archived_at is null)
           and (p_before_item_id is null or exists(select 1 from public.items bi where bi.id=p_before_item_id
                    and bi.org_id=p_org_id and bi.board_id=p_board_id and bi.assigned_to=v_actor)))) then
    raise exception ''row move permission denied'' using errcode=''42501'';
  end if;';
begin
  -- 줄바꿈을 맞춘다: 이 파일·함수 본문 어느 쪽이 CRLF 로 들어와도 같은 덩어리를 찾는다.
  --   운영 본문은 LF 다. 본문에 CR 이 있으면(윈도에서 적용된 사본) 덩어리도 CRLF 로 바꿔 찾는다.
  v_old_gate := replace(v_old_gate, chr(13), '');
  v_new_gate := replace(v_new_gate, chr(13), '');
  if strpos((select prosrc from pg_proc where oid=v_oid), chr(13)) > 0 then
    v_old_gate := replace(v_old_gate, chr(10), chr(13)||chr(10));
    v_new_gate := replace(v_new_gate, chr(10), chr(13)||chr(10));
  end if;
  if not exists(select 1 from pg_roles where oid=v_writer and not rolcanlogin and not rolsuper and not rolinherit)
     or exists(select 1 from pg_proc where oid=v_oid and (proowner<>v_writer or not prosecdef)) then
    raise exception 'unexpected row writer boundary';
  end if;
  select jsonb_build_array(oid,proowner,proacl::text,proconfig), prosrc, pg_get_functiondef(oid)
    into v_before, v_source, v_definition
    from pg_proc where oid=v_oid;
  if (length(v_source) - length(replace(v_source, v_old_gate, ''))) / length(v_old_gate) <> 1
     or (length(v_definition) - length(replace(v_definition, v_old_gate, ''))) / length(v_old_gate) <> 1 then
    raise exception 'expected exactly one row move permission gate in move_board_row_atomic';
  end if;
  v_new_source := replace(v_source, v_old_gate, v_new_gate);
  v_definition := replace(v_definition, v_old_gate, v_new_gate);
  select coalesce(jsonb_agg(to_jsonb(m) order by m.member,m.grantor),'[]'::jsonb) into v_members
    from pg_auth_members m where m.roleid=v_writer;
  v_create := has_schema_privilege(v_writer,'public','CREATE');

  execute format('grant moawork_row_order_writer to %I with set true, inherit false',current_user);
  if not v_create then grant create on schema public to moawork_row_order_writer; end if;
  set local role moawork_row_order_writer;
  execute v_definition;
  reset role;
  if not v_create then revoke create on schema public from moawork_row_order_writer; end if;
  execute format('revoke moawork_row_order_writer from %I',current_user);

  select jsonb_build_array(oid,proowner,proacl::text,proconfig) into v_after from pg_proc where oid=v_oid;
  if v_after is distinct from v_before
     or has_schema_privilege(v_writer,'public','CREATE') is distinct from v_create
     or (select coalesce(jsonb_agg(to_jsonb(m) order by m.member,m.grantor),'[]'::jsonb) from pg_auth_members m where m.roleid=v_writer) is distinct from v_members
     or (select prosrc from pg_proc where oid=v_oid) is distinct from v_new_source then
    raise exception 'row move own-rows change touched the protected boundary';
  end if;
end;
$own_rows$;
