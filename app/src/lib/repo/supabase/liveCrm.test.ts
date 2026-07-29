/**
 * 실DB 왕복 테스트 (T02 · B2 수용기준).
 *
 * 검증 대상 — **실 Supabase 에서** 다음이 성립하는가:
 *   ① 딜 생성 → 기본 단계 배치 + 활동로그 1건 자동 생성
 *   ② 단계 이동 → stage_id 변경 + 활동로그 1건 추가(합계 2건)
 *   ③ member(scope=assigned) 세션은 남의 딜을 못 봄 (?as=member 스코프 유지)
 *
 * 왜 별도 파일인가: 인메모리 테스트는 규칙의 *일관성*만 보증한다. 실제 PostgREST 왕복,
 * generated column, RLS, jsonb 기본값 같은 것은 실DB 에 붙어야만 드러난다.
 *
 * 실행 조건(전부 있어야 실행, 없으면 **skip**):
 *   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   RLS_TEST_ORG_A_EMAIL / RLS_TEST_ORG_A_PASSWORD  (조직 소속 owner/admin)
 *   (선택) RLS_TEST_MEMBER_EMAIL / _PASSWORD — 있으면 ③ 까지 검증
 *
 * ⚠ 비밀값은 저장소에 두지 않는다(app/.env.local 또는 CI 시크릿).
 * 크리덴셜이 없으면 skip 되어 게이트를 막지 않는다 — 대신 "미검증" 상태가 유지된다.
 *
 * ⚠ 이 테스트는 실DB 에 행을 만든다. 끝에서 만든 딜을 지운다(activities 는 cascade).
 */
import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Ctx, Org, User } from "@/lib/types";
import { SupabaseCrmSource } from "./supabaseCrmSource";
import { AsyncCrmService } from "@/lib/crm/asyncService";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const email = process.env.RLS_TEST_ORG_A_EMAIL?.trim();
const password = process.env.RLS_TEST_ORG_A_PASSWORD?.trim();
const memberEmail = process.env.RLS_TEST_MEMBER_EMAIL?.trim();
const memberPassword = process.env.RLS_TEST_MEMBER_PASSWORD?.trim();

const READY = Boolean(url && anon && email && password);
const MEMBER_READY = READY && Boolean(memberEmail && memberPassword);

/** 로그인한 클라이언트 — 이 세션의 JWT 가 RLS 의 auth.uid() 를 채운다(service_role 미사용). */
async function signedInClient(
  mail: string,
  pass: string,
): Promise<{ db: SupabaseClient; userId: string }> {
  const db = createClient(url!, anon!, { auth: { persistSession: false } });
  const { data, error } = await db.auth.signInWithPassword({
    email: mail,
    password: pass,
  });
  if (error || !data.user) throw new Error(`로그인 실패: ${error?.message}`);
  return { db, userId: data.user.id };
}

/** 로그인 사용자가 속한 조직 + 역할/스코프로 Ctx 를 만든다. */
async function ctxFor(db: SupabaseClient, userId: string): Promise<Ctx> {
  const { data: m, error } = await db
    .from("org_members")
    .select("org_id, role, scope")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error || !m) throw new Error(`org_members 조회 실패: ${error?.message}`);

  const { data: org } = await db
    .from("orgs")
    .select("*")
    .eq("id", m.org_id)
    .single();
  const { data: user } = await db
    .from("users")
    .select("*")
    .eq("id", userId)
    .single();

  return {
    user: user as User,
    org: org as Org,
    role: m.role as Ctx["role"],
    scope: m.scope as Ctx["scope"],
  };
}

const createdDealIds: Array<{ db: SupabaseClient; id: string }> = [];

afterAll(async () => {
  // 테스트가 만든 행 정리 — activities 는 001 의 on delete cascade 로 함께 지워진다.
  for (const { db, id } of createdDealIds) {
    await db.from("deals").delete().eq("id", id);
  }
});

describe.skipIf(!READY)("실DB — core.crm 왕복", () => {
  it("딜 생성 → 기본 단계 배치 + 활동로그 자동 1건", async () => {
    const { db, userId } = await signedInClient(email!, password!);
    const ctx = await ctxFor(db, userId);
    const svc = new AsyncCrmService(new SupabaseCrmSource(db));

    const deal = await svc.createDeal(ctx, {
      title: `[자동테스트] 딜 ${Date.now()}`,
    });
    createdDealIds.push({ db, id: deal.id });

    expect(deal.id).toBeTruthy();
    expect(deal.org_id).toBe(ctx.org.id);
    expect(deal.stage_id).toBeTruthy(); // 기본 파이프라인 첫 단계

    const acts = await svc.listActivities(ctx, deal.id);
    expect(acts).toHaveLength(1);
    expect(acts[0].type).toBe("status");
  });

  it("단계 이동 → stage_id 변경 + 활동로그 1건 추가", async () => {
    const { db, userId } = await signedInClient(email!, password!);
    const ctx = await ctxFor(db, userId);
    const svc = new AsyncCrmService(new SupabaseCrmSource(db));

    const deal = await svc.createDeal(ctx, {
      title: `[자동테스트] 이동 ${Date.now()}`,
    });
    createdDealIds.push({ db, id: deal.id });

    const pipelines = await svc.listPipelines(ctx);
    const stages = pipelines.flatMap((p) => p.stages);
    const next = stages.find((s) => s.id !== deal.stage_id);
    expect(next, "이동할 다른 단계가 있어야 한다").toBeTruthy();

    const moved = await svc.moveDealStage(ctx, deal.id, next!.id);
    expect(moved.stage_id).toBe(next!.id);

    const acts = await svc.listActivities(ctx, deal.id);
    expect(acts).toHaveLength(2); // 생성 1 + 이동 1
  });

  it("updateDeal 로는 단계를 바꿀 수 없다(로그 없는 이동 차단)", async () => {
    const { db, userId } = await signedInClient(email!, password!);
    const ctx = await ctxFor(db, userId);
    const svc = new AsyncCrmService(new SupabaseCrmSource(db));

    const deal = await svc.createDeal(ctx, {
      title: `[자동테스트] 불변식 ${Date.now()}`,
    });
    createdDealIds.push({ db, id: deal.id });

    await expect(
      svc.updateDeal(ctx, deal.id, { stage_id: "x" } as never),
    ).rejects.toThrow();
  });
});

describe.skipIf(!MEMBER_READY)("실DB — 담당범위(?as=member) 유지", () => {
  it("member 세션은 남의 담당 딜을 보지 못한다", async () => {
    const mgr = await signedInClient(email!, password!);
    const mgrCtx = await ctxFor(mgr.db, mgr.userId);
    const mgrSvc = new AsyncCrmService(new SupabaseCrmSource(mgr.db));

    // 매니저 담당으로 딜을 만든다(멤버 담당이 아니다).
    const deal = await mgrSvc.createDeal(mgrCtx, {
      title: `[자동테스트] 스코프 ${Date.now()}`,
      assigned_to: mgr.userId,
    });
    createdDealIds.push({ db: mgr.db, id: deal.id });

    const mem = await signedInClient(memberEmail!, memberPassword!);
    const memCtx = await ctxFor(mem.db, mem.userId);
    const memSvc = new AsyncCrmService(new SupabaseCrmSource(mem.db));

    expect(memCtx.scope).toBe("assigned");
    const visible = await memSvc.listDeals(memCtx);
    expect(visible.some((d) => d.id === deal.id)).toBe(false);

    // 단건 조회도 undefined 로 수렴(존재 유출 방지)
    await expect(memSvc.getDeal(memCtx, deal.id)).rejects.toThrow();
  });
});
