/**
 * 기본 탭 «신규리드 관리» — BBE-145. 목업 v6 정본을 그대로 옮긴 것.
 *
 * 정본: `docs/design/UI목업_워크스페이스_최종_v6.html` 탭 `new`
 * 실측: `node docs/design/dump-mockup.mjs new` · 기계 대조는 `new-lead.test.ts` 가
 *       `extractMockupContract()` 를 직접 import 해서 강제한다(사람이 옮겨 적은 값을 믿지 않는다).
 *
 * 아이템(그룹) 5 · 컬럼 29 · 자동 이동 6규칙 · 맨 오른쪽 고정 열 «컨택 이동».
 *
 * ⚠ **`extractMockupContract()` 는 이 탭의 이동 규칙을 10개로 보고한다. 6개가 맞다.**
 *   목업 안에 이동 표가 두 벌 있다.
 *     `MOVE.new`  = {"1차 부재":1,"2차 상담예약":2,"보류":3,"거절":4,"상담 전":null,"2차 상담완료":null}
 *     `MOVE2.new` = {"상담 상황":{"상담 전":0,"1차 부재":1,"2차 상담예약":2,"2차 상담완료":2,"보류":3,"거절":4}}
 *   `MOVE2` 는 «컬럼별» 표로 나중에 추가된 것이고(목업 주석: "상태 외의 컬럼도 아이템을 옮긴다"),
 *   `MOVE` 의 null 두 칸을 채운 **상위집합이자 교정판**이다. 둘 다 같은 «상담 상황» 규칙이다.
 *
 *   그런데 추출기는 `MOVE[key]` 를 «맨 오른쪽 고정 열»(`PINR.new` = 컨택 이동)의 규칙으로
 *   돌린다. `work`·`contact` 탭에서는 그 가정이 맞지만 **`new` 에서만 어긋난다** —
 *   `MOVE.new` 의 값들은 컨택 이동(컨택 대기·컨택 이동·거절)이 아니라 상담 상황의 값이다.
 *   즉 그 4개는 **컬럼이 잘못 붙은 낡은 중복**이다. 실제로 컨택 이동에는 그런 선택지가 없어
 *   규칙을 넣어도 영원히 발화하지 않는 죽은 설정이 된다.
 *
 *   근거 3중: ① 사람이 읽는 `dump-mockup.mjs new` 출력은 `MOVE2` 만 써서 6개를 찍는다
 *   ② 설계도 §1 표 «신규리드 … 상담 상황 기준 6규칙» ③ 컨택 이동의 선택지에 그 값이 없다.
 *   → **6개만 넣는다. 구조를 줄인 것이 아니라 중복 계상을 뺀 것이다.**
 *   → `qa-app.mjs` 의 «자동 이동 규칙 차이 10개» 도 같은 이유로 4개 과다 계상이다. NG-02 인계.
 *
 * ── 목업과 «의도적으로» 다른 3곳 — 전부 근거가 있다. 조용히 줄인 것이 아니다 ──
 *
 * ① `부재 안내` 선택지가 목업 7개 → 6개.
 *    목업의 첫 항목은 **빈 라벨**(`""`)이고 이는 «아직 안 보냄» 상태다. 앱에서 그것은
 *    선택지가 아니라 **값 없음(null)** 이다. 실제로 `boards/validation.ts` 의
 *    `parseOptions` 가 빈 라벨을 거부한다 — 넣으려 해도 못 넣는다.
 *    선택지를 «지운» 것이 아니라 «값 없음» 으로 모델링한 것이다.
 *
 * ② `담당자`·`협업자` 에 정적 선택지를 넣지 않는다 (D71~D75).
 *    목업에는 사람 이름 6개·4개가 박혀 있지만 그건 **예시**다. 담당자 값은
 *    «그 워크스페이스의 멤버 계정» 에서 온다 — 멤버가 1명이면 선택지도 1개다.
 *    `person`/`people` 타입이 그 뜻이고, 구조 팩 테스트도 같은 규칙을 이미 강제한다
 *    ("person 컬럼은 정적 선택지를 갖지 않는다").
 *
 * ③ `시군구` 선택지는 목업의 예시 12개가 아니라 저장소의 실측 지역 사전에서 만든다.
 *    목업의 12개는 첫 고객 샘플 데이터의 잔재고 `dump-mockup` 스스로 «시도별 전체
 *    사전으로» 바꾸라고 적어 뒀다. 새로 지어내지 않고 이미 있는
 *    `region-options.ts`(먼데이 실측 222지)에서 시군구만 뽑아 쓴다.
 *    ⚠ 시도에 딸린 «종속» 선택은 여기서 하지 않는다 — 그건 BBE-127(DC-04) 소유다.
 */

import type { FieldOption } from "@/lib/types";
import { CANONICAL_REGIONS } from "@/lib/structure-packs/region-options";
import { NEW_LEAD_BUSINESS_TYPES } from "@/lib/new-lead/business-types";
import { NEW_LEAD_REVENUE_BANDS } from "@/lib/new-lead/revenue-bands";
import { NEW_LEAD_TAB_SOURCE, type DefaultTab, type DefaultTabColumn } from "./types";
import type { BoardColumn } from "@/lib/boards/types";

/** 목업 색을 그대로 옮긴다. 새 hex 를 만들지 않는다. */
const GREY = "#c4c4c4";

/** `id = label` 규약(구조 팩과 같다). 라벨이 곧 저장값이라 이동 규칙이 읽힌다. */
function opts(...labels: readonly (readonly [string, string])[]): FieldOption[] {
  return labels.map(([label, color], order) => ({ id: label, label, color, order }));
}

/** 그룹 이름 — 이동 규칙이 이 상수를 가리킨다(문자열 오타로 규칙이 죽지 않게). */
export const NEW_LEAD_GROUPS = {
  fresh: "💡 신규고객",
  absent1: "🔇 1차 부재",
  consult2: "🔍 2차 상담고객",
  hold: "📑 보류",
  rejected: "🚫 거절",
} as const;

/**
 * 시도 17 — 목업 그대로. 대한민국 행정구역이라 고객 고유값이 아니다(D71~D75 무관).
 */
const SIDO = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
] as const;

/**
 * 시군구 — 실측 지역 사전(`시도_시군구` 222지)에서 시군구 부분만 뽑아 중복 제거.
 *
 * 같은 이름이 여러 시도에 있으면(`강서구` 서울·부산) 한 항목으로 합쳐진다. 평면 선택지의
 * 한계이고, 시도에 따라 목록이 좁혀지는 «종속 선택» 은 BBE-127(DC-04)이 만든다.
 * 목업의 마지막 항목 `기타` 는 그대로 유지한다.
 */
function sigunguOptions(): FieldOption[] {
  const seen = new Set<string>();
  for (const region of CANONICAL_REGIONS) {
    const name = region.split("_")[1];
    if (name) seen.add(name);
  }
  const labels = [...seen].sort((a, b) => a.localeCompare(b, "ko"));
  labels.push("기타");
  return labels.map((label, order) => ({ id: label, label, order }));
}

/** ✉ 발송 3칸이 기다리는 부품. 이 문구가 화면에 그대로 뜬다. */
export const SEND_PENDING_REASON = "발송 안전장치 대기 — BBE-148 (DC-04)";

/**
 * ✉ 발송 칸 — 바꾸면 **돈이 나가고 고객에게 문자가 간다**(설계도 §2-②).
 *
 * 안전장치(확인 화면 · 건수 · 예상 비용 · 실행 기록)는 DC-04 가 BBE-148 에서 만든다.
 * 그것이 붙기 전까지 **임시로 잠근다** — `readOnly` 는 여기서 구조가 아니라 «자물쇠» 다.
 * 컬럼과 선택지는 목업 그대로 만들어 두고 편집만 막는다. 임시 발송 로직은 짜지 않는다.
 */
function sendColumn(
  key: string,
  label: string,
  options: FieldOption[],
): DefaultTabColumn {
  return {
    key,
    label,
    type: "status",
    source: "msg",
    options,
    readOnly: true,
    pendingReason: SEND_PENDING_REASON,
    width: 140,
  };
}

const COLUMNS: DefaultTabColumn[] = [
  // 1~2 사람 — 선택지는 멤버 계정에서 온다(D71~D75). 정적 옵션 금지.
  { key: "owner", label: "담당자", type: "person", source: "act", width: 120 },
  // 설치 정본은 목업의 역사적 라벨을 보존하고, 실제 화면은 presentNewLeadColumns에서
  // 최신 사용자 어휘인 «출동»으로 바꿔 보여 준다.
  { key: "collaborators", label: "협업자", type: "people", source: "act", width: 150 },

  // 3~12 회사·접수 정보
  { key: "applied_on", label: "신청일", type: "date", source: "auto", width: 120 },
  { key: "ad_name", label: "광고 명", type: "text", source: "auto", width: 120 },
  { key: "phone", label: "연락처", type: "phone", source: "auto", width: 130 },
  { key: "rep_name", label: "대표자명", type: "text", source: "auto", width: 100 },
  {
    key: "biz_reg_type",
    label: "사업자 유형",
    type: "select",
    source: "auto",
    options: opts(...NEW_LEAD_BUSINESS_TYPES.map((label) => [label, GREY] as const)),
    width: 110,
  },
  {
    key: "industry",
    label: "업종/업태",
    type: "select",
    source: "in",
    options: opts(
      ["제조업", GREY], ["도소매업", GREY], ["서비스업", GREY], ["건설업", GREY],
      ["운수업", GREY], ["정보통신업", GREY], ["기타", GREY],
    ),
    width: 120,
  },
  {
    key: "revenue_band",
    label: "매출 구간",
    type: "select",
    source: "auto",
    options: opts(...NEW_LEAD_REVENUE_BANDS.map((label) => [label, GREY] as const)),
    width: 110,
  },
  {
    key: "sido",
    label: "시도",
    type: "select",
    source: "auto",
    options: SIDO.map((label, order) => ({ id: label, label, order })),
    width: 90,
  },
  { key: "sigungu", label: "시군구", type: "select", source: "in", options: sigunguOptions(), width: 110 },
  { key: "email", label: "이메일", type: "email", source: "auto", width: 160 },
  { key: "address_detail", label: "주소", type: "text", source: "auto", width: 180 },
  { key: "documents", label: "파일", type: "file", source: "in", width: 110 },
  { key: "consult_notes", label: "상담내용", type: "text", source: "in", width: 220 },
  // 과거의 출동 예정/완료 상태값. 설치/데이터는 보존하되 실제 신규리드 화면에서는 숨기고
  // `collaborators` 사람 계보를 «출동»으로 보여 준다.
  {
    key: "dispatch_status",
    label: "출동",
    type: "status",
    source: "in",
    options: opts(["미정", GREY], ["출동 예정", "#fdab3d"], ["출동 완료", "#00c875"]),
    width: 110,
  },
  {
    key: "contact_status",
    label: "컨택여부",
    type: "status",
    source: "act",
    options: opts(["미정", GREY], ["컨택 완료", "#00c875"]),
    width: 110,
  },

  // 13~15 ✉ 발송 — 돈이 나간다. DC-04 안전장치 대기(임시 잠금).
  sendColumn(
    "absence_notice",
    "부재 안내",
    // 목업 첫 항목의 빈 라벨은 «값 없음(null)» 이다 — 위 머리말 ① 참고.
    opts(
      ["간편 부재 1회", "#fdab3d"], ["간편 부재 2회", "#fdab3d"], ["간편 부재 3회", "#fdab3d"],
      ["간편 부재 4회", "#fdab3d"], ["간편 부재 5회", "#fdab3d"], ["악성 부재", "#df2f4a"],
    ),
  ),
  sendColumn("consult1_notice", "1차 상담 안내", opts(["보내기 전", GREY], ["1차 상담완료", "#00c875"])),
  sendColumn("confirm2_notice", "2차 확정 안내", opts(["심사 전", GREY], ["심사확정", "#00c875"])),
  sendColumn("delay_notice", "상담지연 메시지", opts(["보내기 전", GREY], ["전달 완료", "#00c875"])),
  sendColumn("malicious_absence_notice", "악성부재 메시지전달", opts(["보내기 전", GREY], ["전달 완료", "#00c875"])),

  // 16 피드백
  {
    key: "feedback_status",
    label: "피드백 상황",
    type: "status",
    source: "act",
    options: opts(
      ["피드백 전", GREY], ["피드백 완료", "#00c875"],
      ["정보보완", "#fdab3d"], ["서류보완", "#df2f4a"],
    ),
    width: 130,
  },

  // 17~20 일정·금액
  { key: "recall_at", label: "재통화 일시", type: "datetime", source: "in", width: 150 },
  { key: "meeting_at", label: "대면미팅 일시", type: "datetime", source: "in", width: 150 },
  { key: "recontact_on", label: "재접촉일", type: "date", source: "in", width: 120 },
  { key: "contract_fee", label: "계약금", type: "money", source: "in", width: 110 },

  // 21 ★ 이 탭의 축 — 값을 바꾸면 카드가 그룹 사이를 옮겨간다(6규칙)
  {
    key: "consult_status",
    label: "상담 상황",
    type: "status",
    source: "act",
    options: opts(
      ["상담 전", GREY], ["1차 부재", "#007eb5"], ["2차 상담예약", "#9d50dd"],
      ["2차 상담완료", "#66ccff"], ["보류", "#fdab3d"], ["거절", "#df2f4a"],
      ["리드컨택으로 넘기기", "#00c875"],
    ),
    moveTo: {
      "상담 전": NEW_LEAD_GROUPS.fresh,
      "1차 부재": NEW_LEAD_GROUPS.absent1,
      "2차 상담예약": NEW_LEAD_GROUPS.consult2,
      "2차 상담완료": NEW_LEAD_GROUPS.consult2,
      보류: NEW_LEAD_GROUPS.hold,
      거절: NEW_LEAD_GROUPS.rejected,
    },
    width: 130,
  },

  // 22 ★ 맨 오른쪽 고정 열 — 이 탭에서 가장 중요한 조작 열(설계도 §2-⑥)
  {
    key: "contact_move",
    label: "컨택 이동",
    type: "status",
    source: "act",
    options: opts(["컨택 대기", GREY], ["컨택 이동", "#00c875"], ["거절", "#df2f4a"]),
    rightPinned: true,
    // 그룹 이동 규칙은 없다 — 머리말 ⚠ 참고(추출기가 상담 상황 규칙을 여기에 잘못 붙인다).
    // 이 열의 일은 «다른 탭으로 보내는 것» 이고 그건 transitions 에 있다.
    width: 130,
  },
];

/** These values remain durable, but belong to the item drawer instead of the table. */
/** 협업자는 상세에서 담당자와 같은 사람 선택기로 편집한다. 컨택 이동은 최신 사용자
 * 확정에 따라 표 맨 오른쪽 고정 관문과 상세 CTA 양쪽에서 접근할 수 있어야 한다. */
export const NEW_LEAD_DETAIL_ONLY_KEYS = new Set<string>();

export const NEW_LEAD_MESSAGE_COLUMN_KEYS = new Set([
  "absence_notice", "consult1_notice", "confirm2_notice", "delay_notice",
  "malicious_absence_notice",
]);

/** 기존 데이터 컬럼은 보존하면서 신규리드 화면만 하나의 업무 조작 열로 합친다. */
export function presentNewLeadColumns(columns: readonly BoardColumn[]): BoardColumn[] {
  const presented: BoardColumn[] = [];
  let messageInserted = false;
  for (const column of columns) {
    if (column.key === "dispatch_status") continue;
    if (NEW_LEAD_MESSAGE_COLUMN_KEYS.has(column.key)) {
      if (!messageInserted) {
        presented.push({
          ...column,
          id: `${column.id}:message-action`,
          key: "message_action",
          label: "메시지 보내기",
          type: "text",
          source: "msg",
          rightPinned: false,
          options_jsonb: null,
          width: 320,
          is_readonly: false,
          description: "상담 안내 문구를 고르고 수신자와 본문을 확인한 뒤 발송",
        });
        messageInserted = true;
      }
      continue;
    }
    if (column.key === "collaborators") {
      presented.push({
        ...column,
        label: "출동",
        description: "최초 접수자부터 다음 담당자까지 상태변경 알림을 함께 받는 인계 계보",
      });
      continue;
    }
    if (column.key === "biz_reg_type") {
      presented.push({
        ...column,
        options_jsonb: { options: opts(...NEW_LEAD_BUSINESS_TYPES.map((label) => [label, GREY] as const)) },
      });
      continue;
    }
    if (column.key === "revenue_band") {
      presented.push({
        ...column,
        options_jsonb: { options: opts(...NEW_LEAD_REVENUE_BANDS.map((label) => [label, GREY] as const)) },
      });
      continue;
    }
    presented.push(column);
  }
  return presented;
}

export const NEW_LEAD_TAB: DefaultTab = {
  key: "new",
  source: NEW_LEAD_TAB_SOURCE,
  name: "신규리드 관리",
  icon: "💡",
  description: "새로 들어온 리드를 상담 상황에 따라 자동으로 분류한다",
  groups: [
    { name: NEW_LEAD_GROUPS.fresh, color: "#FFCB00" },
    { name: NEW_LEAD_GROUPS.consult2, color: "#9CD326" },
    { name: NEW_LEAD_GROUPS.absent1, color: "#0086c0" },
    { name: NEW_LEAD_GROUPS.hold, color: "#FF642E" },
    { name: NEW_LEAD_GROUPS.rejected, color: "#FF158A" },
  ],
  columns: COLUMNS,
  /**
   * 탭 넘김 관문 — 「컨택 이동」이 «컨택 이동» 이 되면 건이 리드컨택 탭으로 «이동» 한다(D78).
   *
   * ⚠ **이번 카드는 이 관문을 실행하지 않는다.** 설계도 §4 의 만드는 순서에서 관문은 3번이고
   *   이 카드는 2번(한 탭 관통)이다. 계약만 여기 남겨 두고, 실제 보드 간 이동은
   *   리드컨택 탭이 선 뒤에 붙인다. 지금 실행하면 갈 곳이 없는 건을 만들어 리드를 잃는다.
   */
  transitions: [
    { columnKey: "consult_status", value: "리드컨택으로 넘기기", to: "contact", guard: null },
    { columnKey: "contact_move", value: "컨택 이동", to: "contact", guard: null },
  ],
};
