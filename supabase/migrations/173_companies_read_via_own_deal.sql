-- moa-migration-guard: logical_key=173_companies_read_via_own_deal predecessor=172_row_move_own_assigned_rows digest=9a6bf72574d16cad6e1b1e3281553be00605793a9c29bfa06623a7d49a590d5e foundation=false

select public.begin_guarded_migration(
  p_logical_key => '173_companies_read_via_own_deal',
  p_file_name => '173_companies_read_via_own_deal.sql',
  p_file_digest => '9a6bf72574d16cad6e1b1e3281553be00605793a9c29bfa06623a7d49a590d5e',
  p_expected_predecessor => '172_row_move_own_assigned_rows',
  p_executor => 'DC',
  p_thread_id => '9ffa2331-f8b8-46fc-9b09-6375b2e85f6c',
  p_foundation => false
);

-- Issue 883 (belie 결정 2026-10-13) — «본인 담당» 직원이 자기가 맡은 업무(딜)의 회사를 업체관리에서 볼 수 있게 한다.
--
--   companies_rw 는 회사 담당자 본인만 허용해서, 회사 담당자가 다른 사람이면 내 업무가 걸린 회사도 아예 안 보였다.
--   읽기만 넓힌다: 같은 워크스페이스 멤버이고 그 회사에 내 담당 딜이 하나라도 있으면 select 허용.
--   수정·삭제·추가는 예전 정책(companies_rw) 그대로 — 회사 담당자·대표·관리자·전체 범위만.
--   deals 정책은 companies 를 참조하지 않으므로 정책끼리 서로 부르는 순환이 없다. deals(org_id, company_id) 색인 있음(001).

drop policy if exists companies_read_via_own_deal on public.companies;
create policy companies_read_via_own_deal on public.companies
  for select to authenticated
  using (
    public.is_org_member(org_id)
    and exists (
      select 1 from public.deals d
       where d.org_id = companies.org_id
         and d.company_id = companies.id
         and d.assigned_to = auth.uid()
    )
  );
