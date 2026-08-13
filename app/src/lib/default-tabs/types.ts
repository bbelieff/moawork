/**
 * 기본 탭(default tab) 도메인 타입 — BBE-145 · D76.
 *
 * **구조 팩(`@/lib/structure-packs`)과 다른 물건이다. 헷갈리면 안 된다.**
 *
 * | | 구조 팩 `seoul-*` | 기본 탭 (이 모듈) |
 * | --- | --- | --- |
 * | 정본 | 먼데이 실측 2026-08-05 | `UI목업_워크스페이스_최종_v6.html` |
 * | 성격 | 그때 먼데이가 어땠는지의 **기록** | 제품이 새 회사에 주는 **기본값** |
 * | 설치 | «구조 팩 설치» 버튼 | 없다 — 워크스페이스에 처음부터 있다(D76) |
 * | 고칠 수 있나 | 못 고친다(테스트가 컬럼 수를 [24,21,24]로 못박고 040 과 대조) | 회사가 자유롭게 고치고 지운다(D76·D77) |
 *
 * 그래서 목업 v6 을 구조 팩에 덮어쓰지 않고 이 모듈을 새로 세웠다. 팩을 고치면
 * 먼데이 실측 추적성이 사라지고(`seoul-pack.test.ts` 가 그것을 지키고 있다),
 * 기존 마이그레이션 040 을 고쳐야 하는데 그건 금지돼 있다(AGENTS.md §9.1).
 *
 * 이동 규칙은 여기서 **그룹 이름**으로 적는다. 설치 시점에야 group id 가 생기므로
 * 설치기(`install.ts`)가 이름 → id 로 해석한다.
 */

import type { FieldOption, FieldType } from "@/lib/types";
import type { FieldSource } from "@/lib/field/source";

/** Product-owned identity for the default new-lead tab. */
export const NEW_LEAD_TAB_SOURCE = "core.default-tab/new-lead";

/** 기본 탭의 컬럼 1개. */
export interface DefaultTabColumn {
  /** `board_columns.key` — `item_values.column_key` 가 이걸 참조한다. 절대 바뀌면 안 된다. */
  key: string;
  label: string;
  type: FieldType;
  /** 값이 어디서 오는가(D09) — 편집 가능 여부를 정한다. */
  source: FieldSource;
  options?: FieldOption[];
  /** 맨 오른쪽 고정 열 — 가로로 스크롤해도 항상 보인다(설계도 §2-⑥). 탭당 1개. */
  rightPinned?: boolean;
  /**
   * 손으로 못 고치는 칸.
   *
   * ⚠ 두 가지 서로 다른 이유로 켜진다 — 도장에 구분해서 적는다.
   *   ① 구조적 — ƒ자동계산·⇄연결(lk) 처럼 원래 사람이 못 고치는 칸
   *   ② **임시 안전장치** — ✉발송 칸. 안전장치(BBE-148 · DC-04)가 오면 «풀린다»
   */
  readOnly?: boolean;
  width?: number | null;
  /**
   * 자동 이동 규칙 — 선택지 id → **목표 그룹 이름**.
   * 설치기가 그룹 이름을 실제 group id 로 바꿔 `board_columns.move_rule_jsonb` 에 넣는다.
   */
  moveTo?: Record<string, string>;
  /**
   * 이 칸이 아직 부품을 기다리는 중이면 그 사유. 화면이 이 문구를 그대로 보여준다.
   * 남의 카드를 임시 구현으로 때우지 않기 위한 자리다(AGENTS.md §3 «소비자 없는 부품»의 반대편).
   */
  pendingReason?: string;
}

/** 기본 탭의 그룹(=아이템) 1개. */
export interface DefaultTabGroup {
  name: string;
  color: string;
}

/** 탭을 넘기는 관문 — 이 값이 되면 «다른 보드» 로 건이 이동한다(설계도 §2-④). */
export interface DefaultTabTransition {
  /** 이동을 유발하는 컬럼 key. */
  columnKey: string;
  /** 그 컬럼이 이 선택지 id 가 되면 넘어간다. */
  value: string;
  /** 목표 탭 key. */
  to: string;
  /** 이중 잠금 — 조건을 못 채우면 차단하고 이유를 보여준다. */
  guard: { columnKey: string; value: string } | null;
}

/** 기본 탭 1개 = 보드 1개. */
export interface DefaultTab {
  /** 목업 탭 key(`new`·`contact`·`work`·`notice`)와 같다 — 대조의 기준. */
  key: string;
  /** Stable product identity stored in boards.source. Names remain user-editable. */
  source: string;
  name: string;
  icon: string;
  description: string;
  groups: DefaultTabGroup[];
  /** 배열 순서가 곧 `sort_order` 이고, 목업 컬럼 순서와 같아야 한다. */
  columns: DefaultTabColumn[];
  transitions: DefaultTabTransition[];
}
