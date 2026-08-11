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
    // 공지사항(core.notice)은 T04 가 003 보드 엔진 위에 얹은 시드 보드다.
    expect(boards.map((b) => b.name)).toEqual([
      "정책자금 파이프라인",
      "업무 요청",
      "공지사항",
    ]);
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

  it("연동·수식 출처는 직접 server 호출로도 덮어쓸 수 없다", () => {
    const linked = svc.addColumn(owner, SEED_BOARD_TASKS, {
      label: "업체 연동값",
      type: "text",
      source: "lk",
    });
    const calculated = svc.addColumn(owner, SEED_BOARD_TASKS, {
      label: "자동 계산값",
      type: "calc",
      source: "calc",
    });
    const item = svc.createItem(owner, SEED_BOARD_TASKS, { title: "x" });
    const result = svc.setCells(owner, SEED_BOARD_TASKS, item.id, {
      [linked.key]: "우회 변경",
      [calculated.key]: 100,
    });

    expect(result.errors.map((error) => error.key)).toEqual([linked.key, calculated.key]);
    expect(result.item.values[linked.key]).toBeUndefined();
    expect(result.item.values[calculated.key]).toBeUndefined();
  });

  // [정책 변경 — 기획2 판정 2026-07-21] 기본은 관대 + 인라인 피드백.
  // 잘못된 값은 던지지 않고 저장도 하지 않으며, errors 로 사유를 돌려준다.
  it("허용되지 않은 선택지는 저장하지 않고 errors 로 보고", () => {
    const item = svc.createItem(owner, SEED_BOARD_TASKS, { title: "x" });
    const res = svc.setCells(owner, SEED_BOARD_TASKS, item.id, { status: "ghost" });

    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].key).toBe("status");
    expect(res.errors[0].message).toBeTruthy();
    expect(res.item.values.status).toBeUndefined(); // 저장되지 않음
  });

  it("한 셀이 틀려도 나머지 정상 값은 저장된다(관대)", () => {
    const item = svc.createItem(owner, SEED_BOARD_TASKS, { title: "x" });
    const res = svc.setCells(owner, SEED_BOARD_TASKS, item.id, {
      status: "ghost", // 실패
      note: "정상 메모", // 통과
    });

    expect(res.errors.map((e) => e.key)).toEqual(["status"]);
    expect(res.item.values.note).toBe("정상 메모");
    expect(res.item.values.status).toBeUndefined();
  });

  it("⛔ 형식 오류를 조용히 null 로 수렴시키지 않는다(데이터 유실 금지)", () => {
    const item = svc.createItem(owner, SEED_BOARD_TASKS, {
      title: "x",
      values: { due: "2026-08-01" },
    });
    const res = svc.setCells(owner, SEED_BOARD_TASKS, item.id, { due: "2026-02-30" });

    expect(res.errors).toHaveLength(1);
    expect(res.item.values.due).toBe("2026-08-01"); // 기존 값 보존 — null 로 덮어쓰지 않음
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

describe("셀 편집 → 아이템 자동 이동 (BBE-14 · D68~D70)", () => {
  // 다른 세션(BBE-123)이 잡은 lib/field/**·components/board/** 는 건드리지 않는다.
  // 여기서는 서비스 계층만으로 이동 규칙을 검증한다(컬럼에 move_rule 을 직접 설정).
  function setupMoveBoard() {
    const detail = svc.createBoard(owner, { name: "이동테스트" });
    const g대기 = svc.addGroup(owner, detail.board.id, { name: "대기" });
    const g완료 = svc.addGroup(owner, detail.board.id, { name: "완료" });
    const g보류 = svc.addGroup(owner, detail.board.id, { name: "보류" });
    const col = svc.addColumn(owner, detail.board.id, {
      label: "상담 상황",
      type: "select",
      options: [
        { id: "opt-wait", label: "상담 전", color: "#ccc", order: 0 },
        { id: "opt-done", label: "완료", color: "#0c0", order: 1 },
        { id: "opt-hold", label: "보류", color: "#fa0", order: 2 },
      ],
      moveRule: { "opt-done": g완료.id, "opt-hold": g보류.id },
    });
    const item = svc.createItem(owner, detail.board.id, {
      title: "테스트건",
      group_id: g대기.id,
    });
    return { boardId: detail.board.id, col, item, g대기, g완료, g보류 };
  }

  it("★ 값을 규칙에 매핑된 선택지로 바꾸면 아이템이 해당 그룹으로 옮겨간다", () => {
    const { boardId, col, item, g완료 } = setupMoveBoard();
    const res = svc.setCells(owner, boardId, item.id, { [col.key]: "opt-done" });
    expect(res.item.group_id).toBe(g완료.id);
    expect(res.item.values[col.key]).toBe("opt-done");
  });

  it("규칙에 없는 값으로 바꾸면 그룹은 그대로다(빈 값·미매핑 선택지)", () => {
    const { boardId, col, item, g대기 } = setupMoveBoard();
    // 이 컬럼엔 opt-wait 에 대한 이동 규칙이 없다 — 매핑 안 된 선택지.
    svc.setCells(owner, boardId, item.id, { [col.key]: "opt-wait" });
    const again = svc.getItem(owner, boardId, item.id);
    expect(again.group_id).toBe(g대기.id);
  });

  it("이동 규칙이 없는 일반 컬럼은 아이템을 옮기지 않는다", () => {
    const { boardId, item, g대기 } = setupMoveBoard();
    svc.setCells(owner, boardId, item.id, { title: "이름만 바뀜" }); // 정의 안 된 키 → 무시되지만 그룹도 불변 확인
    const detail2 = svc.createBoard(owner, { name: "일반컬럼용" });
    const plainCol = svc.addColumn(owner, detail2.board.id, { label: "메모", type: "text" });
    const item2 = svc.createItem(owner, detail2.board.id, { title: "x" });
    svc.setCells(owner, detail2.board.id, item2.id, { [plainCol.key]: "아무값" });
    expect(svc.getItem(owner, detail2.board.id, item2.id).group_id).toBeNull();
    expect(svc.getItem(owner, boardId, item.id).group_id).toBe(g대기.id);
  });

  it("★★ 되돌리기 — 값과 그룹이 편집 직전 상태로 복원된다", () => {
    const { boardId, col, item, g대기, g완료 } = setupMoveBoard();
    const res = svc.setCells(owner, boardId, item.id, { [col.key]: "opt-done" });
    expect(res.item.group_id).toBe(g완료.id);
    expect(res.undo).not.toBeNull();

    const restored = svc.undoCells(owner, boardId, item.id, res.undo!);
    expect(restored.group_id).toBe(g대기.id);
    // EAV 행 자체는 존재하고 값이 null 로 복원된다(행 삭제가 아니라 값 복원) — undefined 아님.
    expect(restored.values[col.key]).toBeNull();
  });

  it("다른 보드 아이템은 되돌리기 전에 거부하고 값을 변경하지 않는다", () => {
    const source = setupMoveBoard();
    const other = svc.createBoard(owner, { name: "다른 보드" });
    const otherColumn = svc.addColumn(owner, other.board.id, { label: "메모", type: "text" });
    const otherItem = svc.createItem(owner, other.board.id, {
      title: "보호할 아이템",
      values: { [otherColumn.key]: "원래 값" },
    });

    expect(() =>
      svc.undoCells(owner, source.boardId, otherItem.id, {
        group_id: null,
        values: { [otherColumn.key]: "변조 값" },
      }),
    ).toThrow(NotFoundError);

    expect(svc.getItem(owner, other.board.id, otherItem.id).values[otherColumn.key]).toBe("원래 값");
  });

  it("되돌리기는 «빈 값 → 규칙 있는 값» 편집도 정확히 원상복구한다(재기입 방식이면 실패하는 경우)", () => {
    // 이전 값이 규칙에 없는 상태(null)에서 규칙 있는 값으로 바뀐 경우,
    // 그냥 이전 값을 다시 넣기만 해서는(재평가) 원래 그룹을 못 찾는다 — group_id 를 명시 복원해야 한다.
    const { boardId, col, item, g대기, g완료 } = setupMoveBoard();
    const first = svc.setCells(owner, boardId, item.id, { [col.key]: "opt-done" });
    expect(first.item.group_id).toBe(g완료.id);

    const back = svc.undoCells(owner, boardId, item.id, first.undo!);
    expect(back.group_id).toBe(g대기.id); // 명시 복원이라 정확히 되돌아간다
  });

  it("여러 조작 열이 한 번에 바뀌면 패치의 마지막 키가 최종 목적지를 정한다", () => {
    const detail = svc.createBoard(owner, { name: "이중조작" });
    const gA = svc.addGroup(owner, detail.board.id, { name: "A" });
    const gB = svc.addGroup(owner, detail.board.id, { name: "B" });
    const gC = svc.addGroup(owner, detail.board.id, { name: "C" });
    const col1 = svc.addColumn(owner, detail.board.id, {
      label: "열1", type: "select",
      options: [{ id: "x", label: "x", color: "#000", order: 0 }],
      moveRule: { x: gB.id },
    });
    const col2 = svc.addColumn(owner, detail.board.id, {
      label: "열2", type: "select",
      options: [{ id: "y", label: "y", color: "#000", order: 0 }],
      moveRule: { y: gC.id },
    });
    const item = svc.createItem(owner, detail.board.id, { title: "z", group_id: gA.id });
    // patch 순회는 Object.entries 순서 = 선언 순서(JS 스펙) → col2 가 마지막.
    const res = svc.setCells(owner, detail.board.id, item.id, {
      [col1.key]: "x",
      [col2.key]: "y",
    });
    expect(res.item.group_id).toBe(gC.id);
  });

  it("동시 편집 — 서로 다른 컬럼을 동시에 고쳐도 서로를 지우지 않는다", () => {
    const detail = svc.createBoard(owner, { name: "동시편집" });
    const colA = svc.addColumn(owner, detail.board.id, { label: "A", type: "text" });
    const colB = svc.addColumn(owner, detail.board.id, { label: "B", type: "text" });
    const item = svc.createItem(owner, detail.board.id, { title: "z" });

    // "동시" = 서로 다른 셀에 대한 두 쓰기가 인터리브되는 것을 순차 호출로 재현.
    // (member 액터로 재현하려 했으나 scope=assigned + 미배정 아이템이라 003 담당범위 규칙에
    //  가로막혀 NotFoundError 였다 — 그건 리포의 정상 동작이지 버그가 아니다. 여기서 검증할 것은
    //  "필드별 EAV 행이 서로 다른 쓰기에 의해 지워지지 않는다"이므로 액터를 owner 로 통일한다.)
    svc.setCells(owner, detail.board.id, item.id, { [colA.key]: "편집1 값" });
    svc.setCells(owner, detail.board.id, item.id, { [colB.key]: "편집2 값" });

    const final = svc.getItem(owner, detail.board.id, item.id);
    expect(final.values[colA.key]).toBe("편집1 값"); // 이후 편집이 이 필드를 지우지 않음
    expect(final.values[colB.key]).toBe("편집2 값");
  });

  it("서로 다른 두 실사용자(오너·멤버)가 같은 아이템의 다른 셀을 고쳐도 안 깨진다", () => {
    const detail = svc.createBoard(owner, { name: "다중사용자편집" });
    const colA = svc.addColumn(owner, detail.board.id, { label: "A", type: "text" });
    const colB = svc.addColumn(owner, detail.board.id, { label: "B", type: "text" });
    // member(scope=assigned)가 이 아이템을 보려면 자기 담당이어야 한다(003 담당범위 규칙).
    const item = svc.createItem(owner, detail.board.id, {
      title: "z",
      assigned_to: SEED_USER_MEMBER,
    });

    svc.setCells(owner, detail.board.id, item.id, { [colA.key]: "오너가 쓴 값" });
    svc.setCells(member, detail.board.id, item.id, { [colB.key]: "멤버가 쓴 값" });

    const final = svc.getItem(owner, detail.board.id, item.id);
    expect(final.values[colA.key]).toBe("오너가 쓴 값");
    expect(final.values[colB.key]).toBe("멤버가 쓴 값");
  });
});

describe("읽기 전용 칸 — ƒ수식 결과는 손으로 못 고친다 (목업 개정 ④)", () => {
  it("read_only 컬럼은 값의 형식과 무관하게 항상 errors 로 거부되고 저장되지 않는다", () => {
    const detail = svc.createBoard(owner, { name: "수식보드" });
    const formula = svc.addColumn(owner, detail.board.id, {
      label: "ƒ재신청 안내일",
      type: "date",
      readOnly: true,
    });
    const item = svc.createItem(owner, detail.board.id, { title: "x" });

    // 형식은 완벽히 유효한 날짜값이지만, read_only 라 그 자체로 거부돼야 한다.
    const res = svc.setCells(owner, detail.board.id, item.id, {
      [formula.key]: "2027-01-01",
    });

    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].key).toBe(formula.key);
    expect(res.item.values[formula.key]).toBeUndefined();
  });

  it("읽기 전용 칸이 껴 있어도 같은 요청의 다른 정상 칸은 저장된다(관대 정책 유지)", () => {
    const detail = svc.createBoard(owner, { name: "수식보드2" });
    const formula = svc.addColumn(owner, detail.board.id, {
      label: "ƒ심사 D-day",
      type: "text",
      readOnly: true,
    });
    const normal = svc.addColumn(owner, detail.board.id, { label: "메모", type: "text" });
    const item = svc.createItem(owner, detail.board.id, { title: "x" });

    const res = svc.setCells(owner, detail.board.id, item.id, {
      [formula.key]: "손으로 써봄",
      [normal.key]: "정상 메모",
    });

    expect(res.errors.map((e) => e.key)).toEqual([formula.key]);
    expect(res.item.values[normal.key]).toBe("정상 메모");
    expect(res.item.values[formula.key]).toBeUndefined();
  });

  it("columnPatch 로 기존 컬럼을 읽기 전용으로 전환할 수 있다", () => {
    const detail = svc.createBoard(owner, { name: "전환테스트" });
    const col = svc.addColumn(owner, detail.board.id, { label: "메모", type: "text" });
    const item = svc.createItem(owner, detail.board.id, { title: "x" });
    svc.setCells(owner, detail.board.id, item.id, { [col.key]: "전환 전엔 됨" });
    expect(svc.getItem(owner, detail.board.id, item.id).values[col.key]).toBe("전환 전엔 됨");

    svc.updateColumn(owner, detail.board.id, col.id, { readOnly: true });
    const res = svc.setCells(owner, detail.board.id, item.id, { [col.key]: "전환 후엔 막힘" });
    expect(res.errors).toHaveLength(1);
    expect(svc.getItem(owner, detail.board.id, item.id).values[col.key]).toBe("전환 전엔 됨"); // 기존 값 보존
  });
});
