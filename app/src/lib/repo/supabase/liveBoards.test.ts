import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { BoardsService } from "@/lib/boards";
import type { Ctx, Org, User } from "@/lib/types";
import { SupabaseBoardsRepo } from "./boardsRepo";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const email = process.env.RLS_TEST_ORG_A_EMAIL?.trim();
const password = process.env.RLS_TEST_ORG_A_PASSWORD?.trim();
const orgBId = process.env.RLS_TEST_ORG_B_ID?.trim();
const writesAllowed = process.env.RLS_TEST_ALLOW_WRITES === "1";
const READY = Boolean(url && anon && email && password && writesAllowed);

async function signedIn(): Promise<{ db: SupabaseClient; ctx: Ctx }> {
  const db = createClient(url!, anon!, { auth: { persistSession: false } });
  const { data: auth, error: authError } = await db.auth.signInWithPassword({
    email: email!,
    password: password!,
  });
  if (authError || !auth.user) throw new Error(`로그인 실패: ${authError?.message}`);

  const { data: member, error: memberError } = await db
    .from("org_members")
    .select("org_id, role, scope")
    .eq("user_id", auth.user.id)
    .limit(1)
    .single();
  if (memberError || !member) throw new Error(`조직 조회 실패: ${memberError?.message}`);

  const [{ data: org, error: orgError }, { data: user, error: userError }] =
    await Promise.all([
      db.from("orgs").select("*").eq("id", member.org_id).single(),
      db.from("users").select("*").eq("id", auth.user.id).single(),
    ]);
  if (orgError || userError || !org || !user) throw new Error("세션 컨텍스트 조회 실패");

  return {
    db,
    ctx: {
      org: org as Org,
      user: user as User,
      role: member.role as Ctx["role"],
      scope: member.scope as Ctx["scope"],
    },
  };
}

const created: Array<{ db: SupabaseClient; id: string }> = [];

afterAll(async () => {
  for (const row of created) await row.db.from("boards").delete().eq("id", row.id);
});

describe.skipIf(!READY)("실DB — boards 영속성과 RLS", () => {
  it("새 저장소 인스턴스에서도 보드·컬럼·아이템·값이 유지된다", async () => {
    const { db, ctx } = await signedIn();
    const first = new BoardsService(new SupabaseBoardsRepo(db));
    const detail = await first.createBoard(ctx, { name: `[자동테스트] 보드 ${Date.now()}` });
    created.push({ db, id: detail.board.id });

    const item = await first.createItem(ctx, detail.board.id, {
      title: "재시작 후 유지",
      values: { [detail.columns[0].key]: detail.columns[0].options_jsonb?.options[0]?.id ?? null },
    });

    const afterRestart = new BoardsService(new SupabaseBoardsRepo(db));
    const reloaded = await afterRestart.getBoardDetail(ctx, detail.board.id);
    const items = await afterRestart.listItems(ctx, detail.board.id);

    expect(reloaded.board.name).toBe(detail.board.name);
    expect(reloaded.columns).toHaveLength(3);
    expect(items.find((row) => row.id === item.id)?.title).toBe("재시작 후 유지");
  });

  it.skipIf(!orgBId)("조직 A 세션은 조직 B 보드를 볼 수 없다", async () => {
    const { db } = await signedIn();
    const { data, error } = await db.from("boards").select("id").eq("org_id", orgBId!);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});
