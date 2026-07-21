import { describe, it, expect, beforeEach } from "vitest";
import { BoardsService, NotFoundError, BoardRuleError } from "./service";
import { LocalBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import {
  SEED_ORG_ID,
  SEED_USER_OWNER,
  SEED_USER_MEMBER,
  SEED_BOARD_PIPELINE,
  SEED_BOARD_TASKS,
} from "@/lib/repo/local/seed";
import { getRepo } from "@/lib/repo";
import type { Ctx, MemberRole, MemberScope } from "@/lib/types";

function ctxFor(userId: string, role: MemberRole, scope: MemberScope): Ctx {
  const repo = getRepo();
  const user = repo.getUser(userId);
  const org = repo.getOrg(SEED_ORG_ID);
  if (!user || !org) throw new Error("seed 누락");
  return { user, org, role, scope };
}

let svc: BoardsService;
let owner: Ctx;
let member: Ctx;

beforeEach(() => {
  resetDb();
  svc = new BoardsService(new LocalBoardsRepo());
  owner = ctxFor(SEED_USER_OWNER, "owner", "all");
  member = ctxFor(SEED_USER_MEMBER, "member", "assigned");
});

describe("보드 목록 — 시스템 + 사용자", () => {
  it("정책자금 파이프라인(시스템)과 사용자 보드가 함께 보인다", () => {
    const boards = svc.listBoards(owner);
    expect(boards.map((b) => b.name)).toEqual(["정책자금 파이프라인", "업무 요청"]);
    expect(boards[0].is_system).toBe(true);
    expect(boards[0].source).toBe("core.crm.pipeline");
    expect(boards[1].is_system).toBe(false);
  });
});

describe("보드 생성 — 기본 컬럼 프로비저닝", () => {
  it("새 보드는 기본 컬럼 3개(상태/담당/마감일)로 시작", () => {
    const detail = svc.createBoard(owner, { name: "채용" });
    expect(detail.board.name).toBe("채용");
    expect(detail.board.is_system).toBe(false);
    expect(detail.columns.map((c) => c.key)).toEqual(["status", "owner", "due"]);
    expect(detail.columns[0].type).toBe("select");
    expect(detail.columns[0].options_jsonb?.options).toHaveLength(3);
  });
});

describe("컬럼 추가 · key 유일성", () => {
  it("13타입 컬럼 추가, 같은 라벨은 key 에 접미사", () => {
    const c1 = svc.addColumn(owner, SEED_BOARD_TASKS, { label: "금액", type: "number" });
    const c2 = svc.addColumn(owner, SEED_BOARD_TASKS, { label: "금액", type: "number" });
    expect(c1.key).toBe("금액");
    expect(c2.key).toBe("금액_2");
  });

  it("select 컬럼은 선택지와 함께 저장", () => {
    const col = svc.addColumn(owner, SEED_BOARD_TASKS, {
      label: "우선순위",
      type: "select",
      options: [
        { id: "p1", label: "높음" },
        { id: "p2", label: "낮음" },
      ],
    });
    expect(col.options_jsonb?.options.map((o) => o.id)).toEqual(["p1", "p2"]);
  });
});

describe("아이템 · 셀 인라인 편집 (EAV)", () => {
  it("아이템 추가 후 셀 값이 타입별로 정규화되어 저장", () => {
    const item = svc.createItem(owner, SEED_BOARD_TASKS, {
      title: "신규 업무",
      values: { status: "opt-todo", due: "2026-08-01T00:00:00Z", note: "  메모  " },
    });
    expect(item.values.status).toBe("opt-todo");
    expect(item.values.due).toBe("2026-08-01"); // date 정규화
    expect(item.values.note).toBe("메모"); // trim
  });

  it("셀 수정이 유지된다(재조회)", () => {
    const item = svc.createItem(owner, SEED_BOARD_TASKS, { title: "x" });
    svc.setCells(owner, SEED_BOARD_TASKS, item.id, { note: "수정됨" });
    const again = svc.getItem(owner, SEED_BOARD_TASKS, item.id);
    expect(again.values.note).toBe("수정됨");
  });

  it("허용되지 않은 선택지는 거부", () => {
    const item = svc.createItem(owner, SEED_BOARD_TASKS, { title: "x" });
    expect(() =>
      svc.setCells(owner, SEED_BOARD_TASKS, item.id, { status: "ghost" }),
    ).toThrow(BoardRuleError);
  });

  it("정의되지 않은 컬럼 키는 무시(EAV 오염 방지)", () => {
    const item = svc.createItem(owner, SEED_BOARD_TASKS, {
      title: "x",
      values: { nope: "값" },
    });
    expect(item.values.nope).toBeUndefined();
  });

  it("컬럼 삭제 시 해당 셀 값도 사라진다", () => {
    const detail = svc.getBoardDetail(owner, SEED_BOARD_TASKS);
    const noteCol = detail.columns.find((c) => c.key === "note");
    if (!noteCol) throw new Error("note 컬럼 없음");
    svc.deleteColumn(owner, SEED_BOARD_TASKS, noteCol.id);
    const items = svc.listItems(owner, SEED_BOARD_TASKS);
    expect(items.every((i) => i.values.note === undefined)).toBe(true);
  });
});

describe("칸반 그룹핑", () => {
  it("select 컬럼 기준 레인 + 미지정 레인", () => {
    const lanes = svc.kanban(owner, SEED_BOARD_TASKS, "status");
    const labels = lanes.map((l) => l.label);
    expect(labels).toEqual(["대기", "진행중", "완료", "미지정"]);
    // 시드: 3건이 각각 doing/todo/done
    expect(lanes.find((l) => l.label === "진행중")?.items).toHaveLength(1);
  });

  it("groupBy 없으면 board_groups 기준", () => {
    const lanes = svc.kanban(owner, SEED_BOARD_TASKS);
    expect(lanes.map((l) => l.label)).toEqual(["이번 주", "다음 주", "미지정"]);
    expect(lanes[0].items).toHaveLength(2);
  });
});

describe("담당범위(scope) 격리 — 003 items 규칙", () => {
  it("member+assigned 는 본인 담당 아이템만 본다", () => {
    const ownerItems = svc.listItems(owner, SEED_BOARD_TASKS);
    const memberItems = svc.listItems(member, SEED_BOARD_TASKS);
    expect(ownerItems).toHaveLength(3);
    expect(memberItems).toHaveLength(2);
    expect(memberItems.every((i) => i.assigned_to === SEED_USER_MEMBER)).toBe(true);
  });

  it("member 가 만든 아이템은 본인에게 배정된다", () => {
    const item = svc.createItem(member, SEED_BOARD_TASKS, { title: "내 업무" });
    expect(item.assigned_to).toBe(SEED_USER_MEMBER);
  });

  it("타인 담당 아이템은 조회 불가(NotFound)", () => {
    const all = svc.listItems(owner, SEED_BOARD_TASKS);
    const others = all.find((i) => i.assigned_to !== SEED_USER_MEMBER);
    if (!others) throw new Error("타인 담당 없음");
    expect(() => svc.getItem(member, SEED_BOARD_TASKS, others.id)).toThrow(NotFoundError);
  });
});

describe("시스템 보드 가드 — 정책자금은 deals 소유", () => {
  it("시스템 보드는 컬럼/아이템 편집 불가", () => {
    expect(() =>
      svc.addColumn(owner, SEED_BOARD_PIPELINE, { label: "x", type: "text" }),
    ).toThrow(BoardRuleError);
    expect(() =>
      svc.createItem(owner, SEED_BOARD_PIPELINE, { title: "x" }),
    ).toThrow(BoardRuleError);
    expect(() => svc.deleteBoard(owner, SEED_BOARD_PIPELINE)).toThrow(BoardRuleError);
  });

  it("시스템 보드도 목록/상세 조회는 된다(메타)", () => {
    const detail = svc.getBoardDetail(owner, SEED_BOARD_PIPELINE);
    expect(detail.board.is_system).toBe(true);
  });
});

describe("보드 삭제", () => {
  it("사용자 보드 삭제 시 아이템/셀도 정리", () => {
    const detail = svc.createBoard(owner, { name: "임시" });
    const item = svc.createItem(owner, detail.board.id, { title: "t" });
    svc.deleteBoard(owner, detail.board.id);
    expect(() => svc.getBoardDetail(owner, detail.board.id)).toThrow(NotFoundError);
    expect(() => svc.getItem(owner, detail.board.id, item.id)).toThrow(NotFoundError);
  });
});
