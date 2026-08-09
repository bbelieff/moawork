import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "@/lib/repo/local/store";
import { SEED_ORG_ID, SEED_USER_ADMIN, SEED_USER_MEMBER, SEED_USER_OWNER } from "@/lib/repo/local/seed";
import type { Ctx } from "@/lib/types";
import { NotFoundError } from "@/lib/boards";
import {
  NOTICE_AUDIENCE_MANAGERS,
  NOTICE_BOARD_SOURCE,
  NOTICE_KEYS,
  NoticeForbiddenError,
  NoticeRuleError,
  NoticesService,
  compareNotices,
  noticeStatusOf,
  todayKst,
  type Notice,
} from ".";

function ctxOf(role: Ctx["role"], scope: Ctx["scope"], userId: string): Ctx {
  return {
    user: { id: userId, email: "t@demo", name: "t", avatar_url: null, created_at: "" },
    org: { id: SEED_ORG_ID, name: "demo", plan_tier: "t1_3", created_at: "" },
    role,
    scope,
  } as Ctx;
}

const owner = () => ctxOf("owner", "all", SEED_USER_OWNER);
const admin = () => ctxOf("admin", "all", SEED_USER_ADMIN);
const member = () => ctxOf("member", "assigned", SEED_USER_MEMBER);

function svc() {
  return new NoticesService();
}

beforeEach(() => {
  resetDb();
});

describe("공지 보드 확보", () => {
  it("시드 보드를 source 로 찾는다", () => {
    const board = svc().findBoard(owner());
    expect(board?.source).toBe(NOTICE_BOARD_SOURCE);
    expect(board?.name).toBe("공지사항");
  });

  it("공지 보드는 is_system=false 여야 한다 (true 면 아이템 CRUD 가 막힌다)", () => {
    expect(svc().findBoard(owner())?.is_system).toBe(false);
  });

  it("ensureBoard 는 기존 보드를 재사용한다(중복 생성 없음)", () => {
    const s = svc();
    const first = s.ensureBoard(owner());
    const second = s.ensureBoard(owner());
    expect(second.id).toBe(first.id);
  });
});

describe("목록 정렬", () => {
  it("상단고정이 항상 먼저 온다", () => {
    const list = svc().list(owner());
    expect(list.length).toBe(3);
    expect(list[0].pinned).toBe(true);
    expect(list[0].title).toContain("계약서 양식 개정");
  });

  it("고정 외에는 게시일 최신순", () => {
    const rest = svc().list(owner()).slice(1);
    expect(rest.map((n) => n.publishedAt)).toEqual(["2026-07-20", "2026-07-15"]);
  });

  it("limit 을 적용한다", () => {
    expect(svc().list(owner(), { limit: 2 })).toHaveLength(2);
    expect(svc().list(owner(), { limit: 0 })).toHaveLength(0);
  });

  it("게시일 미지정은 지정된 것보다 뒤로 간다", () => {
    const base = {
      id: "x", boardId: "b", title: "t", body: "", categoryId: null,
      categoryLabel: null, authorId: null,
      endedAt: null, audienceId: null, audienceLabel: null,
      status: "published" as const,
      createdAt: "2026-01-01", updatedAt: "2026-01-01",
    };
    const withDate: Notice = { ...base, pinned: false, publishedAt: "2026-07-01" };
    const noDate: Notice = { ...base, pinned: false, publishedAt: null };
    expect(compareNotices(withDate, noDate)).toBeLessThan(0);
    expect(compareNotices(noDate, withDate)).toBeGreaterThan(0);
  });
});

describe("EAV 셀 → 뷰모델 변환", () => {
  it("본문·분류라벨·작성자·고정 플래그를 평탄화한다", () => {
    const n = svc().list(owner()).find((x) => x.title.includes("워크숍"))!;
    expect(n.body).toContain("하반기 워크숍");
    expect(n.categoryId).toBe("notice-event");
    expect(n.categoryLabel).toBe("행사");
    expect(n.authorId).toBe(SEED_USER_ADMIN);
    expect(n.pinned).toBe(false);
  });

  it("알 수 없는 분류 id 는 라벨을 null 로 둔다", () => {
    const s = svc();
    const created = s.create(owner(), { title: "분류없음" });
    expect(created.categoryId).toBeNull();
    expect(created.categoryLabel).toBeNull();
  });
});

describe("생성", () => {
  it("제목만으로 생성하면 게시일=오늘·작성자=본인이 채워진다", () => {
    const s = svc();
    const n = s.create(admin(), { title: "신규 공지" });
    expect(n.title).toBe("신규 공지");
    expect(n.publishedAt).toBe(todayKst());
    expect(n.authorId).toBe(SEED_USER_ADMIN);
    expect(n.pinned).toBe(false);
  });

  it("생성한 공지가 목록에 반영된다", () => {
    const s = svc();
    s.create(owner(), { title: "추가됨", pinned: true });
    const list = s.list(owner());
    expect(list).toHaveLength(4);
    expect(list[0].title).toBe("추가됨"); // 고정이므로 최상단
  });

  it("빈 제목은 거부한다", () => {
    expect(() => svc().create(owner(), { title: "   " })).toThrow(NoticeRuleError);
  });

  it("허용되지 않은 분류 id 는 거부한다(보드 엔진 선택지 검증 재사용)", () => {
    expect(() => svc().create(owner(), { title: "x", categoryId: "notice-없는값" })).toThrow();
  });
});

describe("수정", () => {
  it("전달한 키만 바뀌고 나머지 셀은 보존된다", () => {
    const s = svc();
    const before = s.list(owner()).find((n) => n.title.includes("상담 일정"))!;
    const after = s.update(owner(), before.id, { pinned: true });

    expect(after.pinned).toBe(true);
    // 미전달 셀 보존 확인
    expect(after.body).toBe(before.body);
    expect(after.categoryId).toBe(before.categoryId);
    expect(after.publishedAt).toBe(before.publishedAt);
    expect(after.authorId).toBe(before.authorId);
    expect(after.title).toBe(before.title);
  });

  it("제목만 바꿔도 셀이 유지된다", () => {
    const s = svc();
    const before = s.list(owner())[0];
    const after = s.update(owner(), before.id, { title: "제목변경" });
    expect(after.title).toBe("제목변경");
    expect(after.body).toBe(before.body);
    expect(after.pinned).toBe(before.pinned);
  });

  it("빈 제목으로는 수정할 수 없다", () => {
    const s = svc();
    const id = s.list(owner())[0].id;
    expect(() => s.update(owner(), id, { title: "  " })).toThrow(NoticeRuleError);
  });

  it("없는 공지 수정은 NotFound", () => {
    expect(() => svc().update(owner(), "없는id", { pinned: true })).toThrow(NotFoundError);
  });
});

describe("삭제", () => {
  it("삭제하면 목록에서 사라진다", () => {
    const s = svc();
    const target = s.list(owner())[0];
    s.remove(owner(), target.id);
    const list = s.list(owner());
    expect(list).toHaveLength(2);
    expect(list.find((n) => n.id === target.id)).toBeUndefined();
  });

  it("없는 공지 삭제는 NotFound", () => {
    expect(() => svc().remove(owner(), "없는id")).toThrow(NotFoundError);
  });
});

describe("담당범위(scope) — 공지는 조직 전체 공람 (BBE-17)", () => {
  // 이전 계약(DQ-0018)에서는 공지가 assigned_to=null 이라 member+assigned 에게
  // 통째로 보이지 않았다. 공지는 조직 공람물이므로 담당범위 축을 적용하지 않는다.
  // 조직 경계(org_id)는 그대로다 — 열람 제한은 audience/게시상태로만 건다.
  it("owner/admin(scope=all)은 전체 공지를 본다", () => {
    expect(svc().list(owner())).toHaveLength(3);
    expect(svc().list(admin())).toHaveLength(3);
  });

  it("member+assigned 도 조직 공지를 본다", () => {
    expect(svc().list(member())).toHaveLength(3);
  });
});

describe("todayKst", () => {
  it("UTC 늦은 밤은 KST 기준 다음날이다", () => {
    expect(todayKst(new Date("2026-07-21T15:30:00.000Z"))).toBe("2026-07-22");
  });

  it("UTC 이른 시각은 같은 날", () => {
    expect(todayKst(new Date("2026-07-21T00:30:00.000Z"))).toBe("2026-07-21");
  });
});

describe("컬럼 key 계약", () => {
  it("NOTICE_KEYS 는 전부 영문 식별자다(BUG-0002 재발 방지)", () => {
    for (const key of Object.values(NOTICE_KEYS)) {
      expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

// ── BBE-17: 권한 게이트 · 게시 상태 · 열람 대상 ──

describe("쓰기 권한 (BBE-17)", () => {
  // UI 에서 폼을 숨기는 것만으로는 서버 액션·REST 직접 호출을 막지 못한다.
  // 서비스가 마지막 관문이라 여기서 거부되는지 확인한다.
  it("member 는 공지를 작성할 수 없다", () => {
    expect(() => svc().create(member(), { title: "몰래 쓴 공지" })).toThrow(
      NoticeForbiddenError,
    );
  });

  it("member 는 공지를 수정할 수 없다", () => {
    const target = svc().list(owner())[0];
    expect(() => svc().update(member(), target.id, { title: "변조" })).toThrow(
      NoticeForbiddenError,
    );
  });

  it("member 는 공지를 삭제할 수 없다", () => {
    const target = svc().list(owner())[0];
    expect(() => svc().remove(member(), target.id)).toThrow(NoticeForbiddenError);
    expect(svc().list(owner())).toHaveLength(3);
  });

  it("owner/admin 은 작성할 수 있다", () => {
    const s = svc();
    expect(s.create(owner(), { title: "owner 공지" }).title).toBe("owner 공지");
    expect(s.create(admin(), { title: "admin 공지" }).title).toBe("admin 공지");
  });
});

describe("게시 상태 파생 (BBE-17)", () => {
  it("종료일이 오늘보다 앞서면 종료", () => {
    expect(noticeStatusOf("2026-08-01", "2026-08-04", "2026-08-05")).toBe("ended");
  });

  it("종료일이 오늘이면 아직 게시 중(당일 포함)", () => {
    expect(noticeStatusOf("2026-08-01", "2026-08-05", "2026-08-05")).toBe("published");
  });

  it("게시일이 미래면 게시 예정", () => {
    expect(noticeStatusOf("2026-08-09", null, "2026-08-05")).toBe("scheduled");
  });

  it("게시일 미지정은 즉시 게시로 본다", () => {
    expect(noticeStatusOf(null, null, "2026-08-05")).toBe("published");
  });

  it("종료일은 게시일보다 앞설 수 없다", () => {
    expect(() =>
      svc().create(owner(), {
        title: "뒤집힌 기간",
        publishedAt: "2026-08-10",
        endedAt: "2026-08-01",
      }),
    ).toThrow(NoticeRuleError);
  });
});

describe("열람 대상과 게시 상태에 따른 노출 (BBE-17)", () => {
  const NOW = new Date("2026-08-05T00:00:00Z");
  const today = todayKst(NOW);

  function seedOne(extra: Parameters<NoticesService["create"]>[1]) {
    const s = svc();
    for (const n of s.list(owner())) s.remove(owner(), n.id);
    return s.create(owner(), extra);
  }

  it("관리자 전용 공지는 member 에게 보이지 않는다", () => {
    seedOne({ title: "관리자 전용", audienceId: NOTICE_AUDIENCE_MANAGERS, publishedAt: today });
    expect(svc().list(member(), { now: NOW })).toHaveLength(0);
    expect(svc().list(owner(), { now: NOW })).toHaveLength(1);
  });

  it("게시 예정 공지는 member 에게 보이지 않고 관리자에게는 보인다", () => {
    seedOne({ title: "예약 공지", publishedAt: "2026-09-01" });
    expect(svc().list(member(), { now: NOW })).toHaveLength(0);
    const asOwner = svc().list(owner(), { now: NOW });
    expect(asOwner).toHaveLength(1);
    expect(asOwner[0].status).toBe("scheduled");
  });

  it("종료된 공지는 member 에게 보이지 않는다", () => {
    seedOne({ title: "지난 공지", publishedAt: "2026-07-01", endedAt: "2026-07-31" });
    expect(svc().list(member(), { now: NOW })).toHaveLength(0);
    expect(svc().list(owner(), { now: NOW })[0].status).toBe("ended");
  });

  it("게시 중 · 전체 대상 공지는 member 에게 보인다", () => {
    seedOne({ title: "모두 보는 공지", publishedAt: "2026-08-01" });
    expect(svc().list(member(), { now: NOW })).toHaveLength(1);
  });

  it("볼 수 없는 공지의 상세는 NotFound 로 답한다(존재를 알리지 않는다)", () => {
    const hidden = seedOne({
      title: "관리자 전용",
      audienceId: NOTICE_AUDIENCE_MANAGERS,
      publishedAt: today,
    });
    expect(() => svc().get(member(), hidden.id, NOW)).toThrow(NotFoundError);
    expect(svc().get(owner(), hidden.id, NOW).title).toBe("관리자 전용");
  });
});
