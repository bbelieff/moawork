import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIELD_TYPES } from "@/lib/types";
import { DEFERRED_COLUMN_KINDS } from "./types";
import { SEOUL_STRUCTURE_PACK, allSectionPresets } from "./seoul-pack";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
  "031_newcust_structure_pack.sql",
);

const HEX = /^#[0-9a-fA-F]{6}$/;

describe("팩 구성 — 먼데이 실측 2026-08-05", () => {
  it("보드 3개다", () => {
    expect(SEOUL_STRUCTURE_PACK.boards.map((b) => b.slug)).toEqual([
      "newcust",
      "contact",
      "work",
    ]);
  });

  it("아이템 프리셋(= 탭 안의 그룹)은 32종이다 — 14 + 7 + 11", () => {
    const [newcust, contact, work] = SEOUL_STRUCTURE_PACK.boards;
    expect(newcust.sections).toHaveLength(14);
    expect(contact.sections).toHaveLength(7);
    expect(work.sections).toHaveLength(11);
    expect(allSectionPresets()).toHaveLength(32);
  });

  it("아이템 프리셋 이름은 `탭-그룹` 형식이고 팩 전체에서 유일하다", () => {
    const names = allSectionPresets().map((s) => s.name);
    for (const name of names) expect(name).toContain("-");
    expect(new Set(names).size).toBe(names.length);
  });

  it("모든 그룹에 hex 색이 있다", () => {
    for (const section of allSectionPresets()) {
      expect(section.color, `${section.name} 색`).toMatch(HEX);
    }
  });

  it("그룹 순서는 보드마다 0부터 빈틈없이 이어진다", () => {
    for (const board of SEOUL_STRUCTURE_PACK.boards) {
      expect(board.sections.map((s) => s.order)).toEqual(
        board.sections.map((_, index) => index),
      );
    }
  });
});

describe("컬럼 계약", () => {
  it("컬럼 key 는 보드 안에서 유일하다", () => {
    for (const board of SEOUL_STRUCTURE_PACK.boards) {
      const keys = board.columns.map((c) => c.key);
      expect(new Set(keys).size, `${board.slug} 중복 key`).toBe(keys.length);
    }
  });

  it("설치 컬럼 타입은 전부 001 field_type enum 안에 있다", () => {
    for (const board of SEOUL_STRUCTURE_PACK.boards) {
      for (const column of board.columns) {
        expect(FIELD_TYPES, `${board.slug}.${column.key}`).toContain(column.type);
      }
    }
  });

  it("선택지가 있는 컬럼은 select/multiselect 뿐이고, 옵션 색은 hex 다", () => {
    for (const board of SEOUL_STRUCTURE_PACK.boards) {
      for (const column of board.columns) {
        if (!column.options) continue;
        expect(["select", "multiselect"]).toContain(column.type);
        for (const option of column.options) {
          if (option.color !== undefined) expect(option.color).toMatch(HEX);
        }
      }
    }
  });

  it("선택지 순서도 0부터 빈틈없이 이어지고 id 가 유일하다", () => {
    for (const board of SEOUL_STRUCTURE_PACK.boards) {
      for (const column of board.columns) {
        if (!column.options) continue;
        expect(column.options.map((o) => o.order)).toEqual(
          column.options.map((_, index) => index),
        );
        const ids = column.options.map((o) => o.id);
        expect(new Set(ids).size, `${board.slug}.${column.key} 중복 옵션`).toBe(ids.length);
      }
    }
  });

  it("인라인 옵션과 전역 프리셋 참조를 동시에 갖지 않는다", () => {
    for (const board of SEOUL_STRUCTURE_PACK.boards) {
      for (const column of board.columns) {
        expect(
          Boolean(column.options) && Boolean(column.optionRef),
          `${board.slug}.${column.key}`,
        ).toBe(false);
      }
    }
  });

  it("실측 컬럼 수 — 신규고객 24 · 컨텍관리 21 · 업무관리 24 (Name·유예분 제외)", () => {
    expect(SEOUL_STRUCTURE_PACK.boards.map((b) => b.columns.length)).toEqual([24, 21, 24]);
  });

  it("optionRef 는 팩이 실제로 들고 있는 세트만 가리킨다", () => {
    for (const board of SEOUL_STRUCTURE_PACK.boards) {
      for (const column of board.columns) {
        if (!column.optionRef) continue;
        expect(
          SEOUL_STRUCTURE_PACK.optionSets[column.optionRef],
          `${board.slug}.${column.key} → ${column.optionRef}`,
        ).toBeTruthy();
      }
    }
  });
});

describe("시드 확정 3건 — 2026-08-05 MW-총괄 (PLAN-002 §5 WO-1)", () => {
  const [newcust, contact, work] = SEOUL_STRUCTURE_PACK.boards;

  it("① Name 은 3보드 모두 업체명이고, 중복 `회사명` 컬럼이 없다", () => {
    for (const board of SEOUL_STRUCTURE_PACK.boards) {
      expect(board.nameColumn.label, `${board.slug} Name`).toBe("업체명");
      const labels = board.columns.map((c) => c.label);
      expect(labels, `${board.slug} 회사명 잔존`).not.toContain("회사명");
    }
  });

  it("① 먼데이 실측 컬럼 수와 대조된다 — 신규고객 28 · 컨텍관리 25 · 업무관리 32", () => {
    // 팩(Name 1 + 설치 + 유예) + 중복이라 뺀 컬럼 = 먼데이 실측 총수.
    const MONDAY_TOTAL: Record<string, number> = { newcust: 28, contact: 25, work: 32 };
    const REMOVED: Record<string, string[]> = {
      newcust: ["회사명"],
      contact: ["회사명", "담당자 구분"],
      work: ["회사명"],
    };
    for (const board of SEOUL_STRUCTURE_PACK.boards) {
      const seeded = 1 + board.columns.length + board.deferredColumns.length;
      expect(seeded + REMOVED[board.slug].length, `${board.slug} 대조`).toBe(
        MONDAY_TOTAL[board.slug],
      );
    }
    // 신규고객 28 → 27 (PLAN-002 §5 WO-1 ① 이 못박은 숫자)
    expect(1 + newcust.columns.length + newcust.deferredColumns.length).toBe(27);
  });

  it("② 지역은 두 보드가 같은 공용 세트 1개를 참조한다", () => {
    const refs = SEOUL_STRUCTURE_PACK.boards.flatMap((board) =>
      board.columns.filter((c) => c.label === "지역").map((c) => c.optionRef),
    );
    expect(refs).toEqual(["region", "region"]);
    expect(SEOUL_STRUCTURE_PACK.optionSets.region).toHaveLength(222);
  });

  it("③ 담당자는 3보드 모두 멤버(사람) 컬럼이고 선택지형 담당자가 없다", () => {
    for (const board of SEOUL_STRUCTURE_PACK.boards) {
      const owners = board.columns.filter((c) => c.label.startsWith("담당자"));
      expect(owners.map((c) => c.type), `${board.slug} 담당자 타입`).toEqual(["person"]);
    }
  });

  it("③ 설치 선택지에 직원 실명이 남아 있지 않다 — 전역 카탈로그 PII", () => {
    // 그룹 이름(아이템 프리셋 32종)은 먼데이 원본이라 유지한다. 여기서 막는 건
    // 조직마다 달라지는 사람을 컬럼 선택지에 박아 두는 것이다.
    const STAFF = ["이대표", "박정화", "담당자 미정"];
    for (const board of SEOUL_STRUCTURE_PACK.boards) {
      for (const column of board.columns) {
        for (const option of column.options ?? []) {
          for (const name of STAFF) {
            expect(option.label.includes(name), `${board.slug}.${column.key}=${option.label}`).toBe(
              false,
            );
          }
        }
      }
    }
    for (const view of [...newcust.views, ...contact.views, ...work.views]) {
      expect(view.filters ?? {}, `${view.name} 뷰 필터`).toEqual({});
    }
  });
});

describe("유예 컬럼 — 구조만 기록하고 설치하지 않는다 (PLAN-003)", () => {
  it("유예 종류는 정의된 목록 안에 있다", () => {
    for (const board of SEOUL_STRUCTURE_PACK.boards) {
      for (const column of board.deferredColumns) {
        expect(DEFERRED_COLUMN_KINDS).toContain(column.kind);
      }
    }
  });

  it("유예 컬럼 key 는 설치 컬럼과 겹치지 않는다", () => {
    for (const board of SEOUL_STRUCTURE_PACK.boards) {
      const installed = new Set(board.columns.map((c) => c.key));
      for (const column of board.deferredColumns) {
        expect(installed.has(column.key), `${board.slug}.${column.key}`).toBe(false);
      }
    }
  });

  it("업무관리 수식 4종이 원문과 함께 기록돼 있다", () => {
    const work = SEOUL_STRUCTURE_PACK.boards[2];
    const formulas = work.deferredColumns.filter((c) => c.kind === "formula");
    expect(formulas.map((f) => f.label)).toEqual([
      "수수료(원)",
      "총 매출액",
      "D+180",
      "D+365",
    ]);
    for (const formula of formulas) expect(formula.source).toBeTruthy();
  });
});

describe("마이그레이션 031 과 앱 팩이 같은 데이터다", () => {
  // 팩이 SQL 과 TS 양쪽에 있으므로 한쪽만 고치면 조용히 어긋난다. 여기서 막는다.
  it("SQL 에 심긴 pack_jsonb 가 TS 팩과 완전히 일치한다", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const start = sql.indexOf("$json$");
    const end = sql.lastIndexOf("$json$");
    expect(start, "migration 에 $json$ 블록이 있어야 한다").toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const embedded = JSON.parse(sql.slice(start + "$json$".length, end));
    expect(embedded).toEqual(JSON.parse(JSON.stringify(SEOUL_STRUCTURE_PACK)));
  });

  it("마이그레이션이 기존 파일을 고치지 않는 additive 형태다", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toContain("create table if not exists structure_packs");
    expect(sql).toContain("enable row level security");
    // 기존 테이블 변경·삭제가 없어야 한다.
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/alter\s+table\s+(boards|items|board_columns|board_groups)\b/i);
  });
});
