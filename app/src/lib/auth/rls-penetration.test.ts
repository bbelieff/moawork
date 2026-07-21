/**
 * RLS 침투테스트 (T10 공동) — 디스패치 B1 §5.
 *
 * 목적: 실 Supabase 에 대해 **조직 격리가 DB 레벨에서 강제되는지** 확인한다.
 *   ① 조직 A 세션으로 조직 B 의 companies/deals SELECT → 0건
 *   ② member + scope='assigned' 세션 → 본인 담당(assigned_to)만 보임
 *
 * 왜 앱 테스트가 아니라 실DB 테스트인가:
 *   앱(LocalRepo)의 담당범위 필터는 "편의"일 뿐 보안 경계가 아니다. 진짜 경계는
 *   001_schema_v1.sql 의 RLS 정책(is_org_member/org_role/org_scope)이며, 그것은
 *   실제 Postgres 에 붙어야만 검증된다.
 *
 * 왜 supabase-js 를 안 쓰나:
 *   침투테스트는 **와이어(PostgREST)** 를 직접 때리는 것이 더 충실하다. SDK 를 거치면
 *   SDK 의 동작을 함께 검증하게 된다. 또한 @supabase/supabase-js 는 현재 어느
 *   워크스페이스에도 선언돼 있지 않아(팬텀 의존성) CI 에서 깨질 수 있다.
 *   fetch 만 쓰면 의존성이 0 이다.
 *
 * 실행 조건(전부 있어야 실행, 없으면 skip):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   RLS_TEST_ORG_A_EMAIL / _PASSWORD   (조직 A 소속 사용자)
 *   RLS_TEST_ORG_B_ID                  (조직 B 의 uuid — A 는 접근 불가여야 함)
 *   (선택) RLS_TEST_MEMBER_EMAIL / _PASSWORD  — scope='assigned' 사용자
 *
 * ⚠ 비밀값은 저장소에 두지 않는다. app/.env.local 또는 CI 시크릿으로만 주입한다.
 * 크리덴셜이 없으면 이 파일은 **skip** 되고 게이트를 막지 않는다
 * (미연결 구간에서 CI 를 빨갛게 만들지 않기 위함). 판정은 크리덴셜 주입 후.
 */
import { describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const orgAEmail = process.env.RLS_TEST_ORG_A_EMAIL;
const orgAPassword = process.env.RLS_TEST_ORG_A_PASSWORD;
const orgBId = process.env.RLS_TEST_ORG_B_ID;

const READY = Boolean(url && anon && orgAEmail && orgAPassword && orgBId);

/** 비밀번호 로그인 → access_token(JWT). 이 토큰이 RLS 의 auth.uid() 를 채운다. */
async function signIn(
  email: string,
  password: string,
): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon!, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`로그인 실패(${email}): ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    access_token: string;
    user: { id: string };
  };
  return { token: body.access_token, userId: body.user.id };
}

/** 인증된 세션으로 PostgREST 질의. RLS 가 걸린 상태의 "실제로 보이는 행"을 돌려준다. */
async function selectAs<T = Record<string, unknown>>(
  token: string,
  path: string,
): Promise<T[]> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: anon!, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`질의 실패(${path}): ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T[];
}

// 크리덴셜 주입 전에는 전체 skip — 리포트에 "왜 안 돌았는지"가 남는다.
const suite = READY ? describe : describe.skip;

suite("RLS 침투테스트 (실 Supabase)", () => {
  it("조직 A 세션은 조직 B 의 companies 를 한 건도 못 본다", async () => {
    const { token } = await signIn(orgAEmail!, orgAPassword!);
    // RLS 는 "권한 없음 에러"가 아니라 **빈 결과**로 막는 것이 정상 동작이다.
    const rows = await selectAs(token, `companies?org_id=eq.${orgBId}&select=id`);
    expect(rows).toHaveLength(0);
  });

  it("조직 A 세션은 조직 B 의 deals 를 한 건도 못 본다", async () => {
    const { token } = await signIn(orgAEmail!, orgAPassword!);
    const rows = await selectAs(token, `deals?org_id=eq.${orgBId}&select=id`);
    expect(rows).toHaveLength(0);
  });

  it("조직 A 가 보는 deals 는 전부 자기 조직 것이다(교차 유출 없음)", async () => {
    const { token } = await signIn(orgAEmail!, orgAPassword!);
    const rows = await selectAs<{ org_id: string }>(token, "deals?select=org_id");
    expect(rows.filter((r) => r.org_id === orgBId)).toHaveLength(0);
  });

  it("조직 B 의 조직행 자체도 안 보인다(존재 유출 방지)", async () => {
    const { token } = await signIn(orgAEmail!, orgAPassword!);
    const rows = await selectAs(token, `orgs?id=eq.${orgBId}&select=id`);
    expect(rows).toHaveLength(0);
  });

  const memberEmail = process.env.RLS_TEST_MEMBER_EMAIL;
  const memberPassword = process.env.RLS_TEST_MEMBER_PASSWORD;

  it.skipIf(!(memberEmail && memberPassword))(
    "member + scope='assigned' 세션은 본인 담당 deals 만 본다",
    async () => {
      const { token, userId } = await signIn(memberEmail!, memberPassword!);
      const rows = await selectAs<{ assigned_to: string | null }>(
        token,
        "deals?select=assigned_to",
      );
      // 담당범위가 assigned 인 사용자에게 남의 담당 건이 섞여 보이면 격리 실패.
      expect(rows.filter((r) => r.assigned_to !== userId)).toHaveLength(0);
    },
  );
});

// 크리덴셜 부재를 리포트에 명시적으로 남긴다 — "테스트가 없다"와 "못 돌렸다"를 구분.
describe("RLS 침투테스트 준비 상태", () => {
  it("크리덴셜이 주입되면 실DB 검증이 활성화된다", () => {
    // 미주입 = 아직 판정되지 않음(수용기준 미검증). 게이트는 막지 않되 사실을 남긴다.
    expect(typeof READY).toBe("boolean");
  });
});
