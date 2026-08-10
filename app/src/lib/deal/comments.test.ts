import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx, MemberRole, MemberScope } from "@/lib/types";
import { getRepo } from "@/lib/repo";
import { resetDb } from "@/lib/repo/local/store";
import { SEED_ORG_ID, SEED_USER_MEMBER, SEED_USER_OWNER } from "@/lib/repo/local/seed";
import { getCrmService } from "@/lib/crm";
import {
  COMMENT_KINDS,
  CommentNotFoundError,
  CommentValidationError,
  ConcurrentEditError,
  addComment,
  applyCommentEdit,
  appendComment,
  editComment,
  extractMentionNames,
  listComments,
  readComments,
  validateCommentBody,
} from "./comments";

function ctxFor(userId: string, role: MemberRole, scope: MemberScope): Ctx {
  const repo = getRepo();
  const user = repo.getUser(userId);
  const org = repo.getOrg(SEED_ORG_ID);
  if (!user || !org) throw new Error("seed 누락");
  return { user, org, role, scope };
}

let owner: Ctx;
let member: Ctx;

beforeEach(() => {
  resetDb();
  owner = ctxFor(SEED_USER_OWNER, "owner", "all");
  member = ctxFor(SEED_USER_MEMBER, "member", "assigned");
});

describe("readComments — 순수 파싱", () => {
  it("형식이 어긋난 값은 걸러낸다", () => {
    const custom = { comments: [{ id: "1", body: "ok" }, { garbage: true }, "nope", null] };
    expect(readComments(custom)).toHaveLength(1);
  });

  it("comments 키가 없거나 배열이 아니면 빈 배열", () => {
    expect(readComments(null)).toEqual([]);
    expect(readComments({})).toEqual([]);
    expect(readComments({ comments: "not-array" })).toEqual([]);
  });

  it("kind 필드가 없던 과거 저장분은 note 로 수렴한다(하위호환)", () => {
    const [c] = readComments({ comments: [{ id: "1", body: "옛날 댓글" }] });
    expect(c.kind).toBe(COMMENT_KINDS.note);
  });

  it("kind=return_request 는 보존된다", () => {
    const [c] = readComments({ comments: [{ id: "1", body: "보완요청", kind: "return_request" }] });
    expect(c.kind).toBe(COMMENT_KINDS.returnRequest);
  });
});

describe("appendComment / applyCommentEdit — 불변 조작 + 다른 custom 키 보존", () => {
  it("appendComment 는 다른 custom 키를 건드리지 않는다(BUG-0003 유형 회귀 방지)", () => {
    const custom = { 계약상황: "진행중", files: [{ id: "f1" }] };
    const next = appendComment(custom, {
      id: "c1",
      author_id: "u1",
      body: "안녕",
      kind: COMMENT_KINDS.note,
      mentioned_ids: [],
      created_at: "2026-01-01T00:00:00.000Z",
      edited_at: null,
      edit_history: [],
      version: 1,
    });
    expect(next["계약상황"]).toBe("진행중");
    expect(next["files"]).toEqual([{ id: "f1" }]);
    expect(readComments(next)).toHaveLength(1);
  });

  it("applyCommentEdit 는 대상 댓글만 바꾸고 나머지는 그대로 둔다", () => {
    const base = appendComment(appendComment(undefined, cmt("a", "첫번째")), cmt("b", "두번째"));
    const next = applyCommentEdit(base, "a", "고친 첫번째", "2026-01-02T00:00:00.000Z");
    const comments = readComments(next);
    expect(comments.find((c) => c.id === "a")?.body).toBe("고친 첫번째");
    expect(comments.find((c) => c.id === "b")?.body).toBe("두번째");
  });

  it("수정 이력에 이전 본문이 쌓인다", () => {
    let custom = appendComment(undefined, cmt("a", "v1"));
    custom = applyCommentEdit(custom, "a", "v2", "2026-01-02T00:00:00.000Z");
    custom = applyCommentEdit(custom, "a", "v3", "2026-01-03T00:00:00.000Z");
    const [c] = readComments(custom);
    expect(c.body).toBe("v3");
    expect(c.edit_history.map((h) => h.body)).toEqual(["v1", "v2"]);
  });
});

describe("validateCommentBody", () => {
  it("빈 문자열/공백만 있으면 거부", () => {
    expect(() => validateCommentBody("")).toThrow(CommentValidationError);
    expect(() => validateCommentBody("   ")).toThrow(CommentValidationError);
  });
  it("앞뒤 공백은 trim 된다", () => {
    expect(validateCommentBody("  안녕  ")).toBe("안녕");
  });
  it("4000자를 넘으면 거부", () => {
    expect(() => validateCommentBody("a".repeat(4001))).toThrow(CommentValidationError);
  });
});

describe("extractMentionNames", () => {
  it("본문에서 @이름 패턴을 뽑는다(중복 제거)", () => {
    expect(extractMentionNames("@철수 확인해줘 @영희 @철수")).toEqual(["철수", "영희"]);
  });
  it("멘션이 없으면 빈 배열", () => {
    expect(extractMentionNames("그냥 댓글")).toEqual([]);
  });
});

describe("addComment / listComments — 서비스(비동기, 프로덕션 경로와 동일)", () => {
  it("추가한 댓글이 목록에 오래된 순으로 보인다", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "댓글 테스트" });
    await addComment(owner, deal.id, { body: "첫번째" });
    await addComment(owner, deal.id, { body: "두번째" });

    const list = await listComments(owner, deal.id);
    expect(list.map((c) => c.body)).toEqual(["첫번째", "두번째"]);
    expect(list[0].author_id).toBe(owner.user.id);
  });

  it("mentionedIds 를 저장한다", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "멘션 테스트" });
    await addComment(owner, deal.id, { body: "확인 부탁", mentionedIds: [member.user.id] });
    const [c] = await listComments(owner, deal.id);
    expect(c.mentioned_ids).toEqual([member.user.id]);
  });

  it("kind 를 지정하지 않으면 note", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "kind 기본값" });
    await addComment(owner, deal.id, { body: "일반 댓글" });
    const [c] = await listComments(owner, deal.id);
    expect(c.kind).toBe(COMMENT_KINDS.note);
  });

  it("빈 본문은 거부되고 저장되지 않는다", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "빈 댓글" });
    await expect(addComment(owner, deal.id, { body: "  " })).rejects.toBeInstanceOf(
      CommentValidationError,
    );
    expect(await listComments(owner, deal.id)).toHaveLength(0);
  });

  it("다른 custom 값(계약상황 등)을 지우지 않는다", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "custom 보존" });
    await getCrmService().updateDeal(owner, deal.id, { custom: { 계약상황: "진행중" } });
    await addComment(owner, deal.id, { body: "댓글" });

    const after = await getCrmService().getDeal(owner, deal.id);
    expect(after.custom?.["계약상황"]).toBe("진행중");
  });

  it("member 는 남의 딜에 댓글을 달 수 없다(NotFound — 존재 유출 방지)", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "오너 딜" });
    await expect(addComment(member, deal.id, { body: "몰래 댓글" })).rejects.toThrow();
  });
});

describe("editComment — 낙관적 잠금(동시수정 충돌, 정수 version 비교)", () => {
  it("새 댓글은 version=1 로 시작한다", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "버전 시작값" });
    const created = await addComment(owner, deal.id, { body: "원본" });
    expect(created.version).toBe(1);
  });

  it("expectedVersion 이 현재 값과 같으면 정상 수정되고 version 이 1 오른다", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "수정 테스트" });
    const created = await addComment(owner, deal.id, { body: "원본" });

    const edited = await editComment(owner, deal.id, created.id, {
      body: "수정본",
      expectedVersion: created.version,
    });

    expect(edited.body).toBe("수정본");
    expect(edited.version).toBe(created.version + 1);
    expect(edited.edited_at).not.toBeNull();
    expect(edited.edit_history).toHaveLength(1);
    expect(edited.edit_history[0].body).toBe("원본");
  });

  it("expectedVersion 이 다르면(동시수정) ConcurrentEditError — 값을 덮어쓰지 않는다", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "충돌 테스트" });
    const created = await addComment(owner, deal.id, { body: "원본" });

    // 다른 세션이 먼저 고쳤다고 가정 — 실제로 한 번 수정해 version 을 올려둔다.
    await editComment(owner, deal.id, created.id, {
      body: "먼저 온 수정",
      expectedVersion: created.version,
    });

    // 내가 들고 있던 오래된 expectedVersion(=1) 으로 다시 수정 시도 → 충돌.
    // (밀리초 타임스탬프였다면 같은 ms 안에서 이 시나리오를 놓칠 수 있었다 — 그래서 정수 버전을 쓴다.)
    await expect(
      editComment(owner, deal.id, created.id, {
        body: "내가 늦게 보낸 수정",
        expectedVersion: created.version,
      }),
    ).rejects.toBeInstanceOf(ConcurrentEditError);

    const [current] = await listComments(owner, deal.id);
    expect(current.body).toBe("먼저 온 수정"); // 덮어써지지 않았다
    expect(current.version).toBe(2); // 충돌 시도는 반영되지 않아 여전히 2
  });

  it("존재하지 않는 댓글이면 CommentNotFoundError", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "없는 댓글" });
    await expect(
      editComment(owner, deal.id, "없는id", { body: "x", expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(CommentNotFoundError);
  });

  it("연속 수정: 두 번째 수정은 첫 번째 수정 이후의 version 을 기대해야 한다", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "연속 수정" });
    const created = await addComment(owner, deal.id, { body: "v1" });

    const afterFirst = await editComment(owner, deal.id, created.id, {
      body: "v2",
      expectedVersion: created.version,
    });
    const afterSecond = await editComment(owner, deal.id, created.id, {
      body: "v3",
      expectedVersion: afterFirst.version,
    });

    expect(afterSecond.body).toBe("v3");
    expect(afterSecond.version).toBe(3);
    expect(afterSecond.edit_history.map((h) => h.body)).toEqual(["v1", "v2"]);
  });
});

function cmt(id: string, body: string) {
  return {
    id,
    author_id: "u1",
    body,
    kind: COMMENT_KINDS.note,
    mentioned_ids: [],
    created_at: "2026-01-01T00:00:00.000Z",
    version: 1,
    edited_at: null,
    edit_history: [],
  };
}
