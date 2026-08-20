/** 정책자금 업종의 역사 이관 매핑 사전이다. 실측 출처는 첫 고객의 먼데이 원본이며, 제품 기본 구조의 정본은 docs/design/UI목업_워크스페이스_최종_v6.html 이다. */
/**
 * 첫 고객의 `🔥업무관리` 보드 구조 — 먼데이 실측 2026-08-05.
 *
 * 원본 식별자는 `docs/design/먼데이-전체스키마-v1.md` 에만 보관한다. 3보드 중 컬럼이 가장 많고 수식이 몰려 있다.
 * 수식·타임라인은 003 엔진에 대응 타입이 없어 `deferredColumns` 로만 기록한다
 * (PLAN-002 §5 WO-1: "계산 엔진·하위아이템 실동작은 PLAN-003 범위").
 *
 * 저장 뷰는 이름·구조만 심는다. 다중값 필터는 WO-3 소유다.
 */

import type { PackBoard } from "./types";

const GREY = "#c4c4c4";

/** 먼데이 `진행 상품` 드롭다운 실측 59종. 순서는 원본 id 오름차순. */
const PRODUCT_LABELS = [
  "개발기술사업화", "제조현장스마트화", "Net-Zero유망기업", "스케일업 금융",
  "내수기업 수출기업화", "수출기업글로벌화", "긴급경영안정", "사업전환",
  "매출채권팩토링", "동반성장네트워크론", "창업기반지원", "혁신성장지원",
  "구조개선전용", "소공인특화자금", "일반자금", "긴급경영안정자금(재해피해)",
  "긴급경영안정자금(일시적 경영애로)", "장애인기업지원자금", "청년고용연계자금",
  "대환대출", "혁신성장_일반형", "혁신성장_혁신형", "민간투자연계형매칭융자",
  "신용취약소상공인자금", "재도전특별자금(일반형)", "재도전특별자금(희망형)",
  "재도전특별자금(도약형)", "상생성장지원자금", "수출바우처", "제조바우처",
  "혁신바우처", "예비창업패키지", "초기창업패키지", "청년창업패키지",
  "청년창업사관학교", "희망리턴_재창업", "희망리턴_경영개선", "일반운전자금",
  "시설자금", "재단 안심통장_1천", "특례보증", "지역금융 협약보증",
  "ISO 9001", "ISO 14001", "ISO 45001", "연구소개발전담부서",
  "벤처기업인증(혁신)", "이노비즈인증", "메인비즈인증", "벤처기업인증(연구)",
  "벤처기업인증(투자)", "혁신성장_혁신형_수출", "혁신성장_혁신형_매출",
  "혁신성장_혁신형_스마트공장", "혁신성장_졸업후보", "취약계층 희망드림 특례보증",
  "신한금융 협약보증", "지역 특례보증(경북버팀금융)", "일시적경영애로",
];

export const POLICYFUND_WORK_BOARD: PackBoard = {
  slug: "work",
  name: "🔥업무관리",
  icon: "🔥",
  description: "실행 단계 — 기관·상품별 진행과 수수료 정산",
  // 시드 확정 ①: Name = 업체명. 중복 `회사명`(text) 제외
  // → 먼데이 32컬럼 = 팩 31(Name 1 + 설치 24 + 유예 6) + 제거 1.
  nameColumn: { label: "업체명", mondayLabel: "이름" },

  columns: [
    { key: "project_owner", label: "담당자", type: "person", width: 110 },
    { key: "link_mky5wdr", label: "홈페이지", type: "url", width: 140 },
    { key: "dropdown_mky5vvck", label: "사업자유형", type: "multiselect", optionRef: "biz_reg_type", width: 120 },
    { key: "date_mky57cjt", label: "창업년도", type: "date", width: 110 },
    { key: "file", label: "파일", type: "file", width: 90 },
    { key: "link_mm5eqwt6", label: "링크", type: "url", width: 120 },
    { key: "numeric_mky5jtvz", label: "연 매출액", type: "number", width: 120 },
    { key: "text0", label: "대표자명", type: "text", width: 100 },
    { key: "email_mm40ka2r", label: "이메일", type: "email", width: 160 },
    { key: "phone", label: "전화번호", type: "phone", width: 130 },
    {
      key: "color_mky856yd",
      label: "업종/업태",
      type: "select",
      width: 140,
      options: [
        { id: "제조업", label: "제조업", color: "#fdab3d", order: 0 },
        { id: "도소매업", label: "도소매업", color: "#00c875", order: 1 },
        { id: "서비스업", label: "서비스업", color: "#df2f4a", order: 2 },
        { id: "일반음식점/배달전문", label: "일반음식점/배달전문", color: "#007eb5", order: 3 },
        { id: "건설업", label: "건설업", color: "#9d50dd", order: 4 },
        { id: "프랜차이즈업", label: "프랜차이즈업", color: "#037f4c", order: 5 },
        { id: "정보통신업", label: "정보통신업", color: "#579bfc", order: 6 },
        { id: "운수업/유통업", label: "운수업/유통업", color: "#cab641", order: 7 },
        { id: "어,농,축업", label: "어,농,축업", color: "#ffcb00", order: 8 },
        { id: "미지정", label: "미지정", color: GREY, order: 9 },
      ],
    },
    { key: "dropdown_mky78058", label: "지역", type: "multiselect", optionRef: "region", width: 140 },
    {
      key: "color3",
      label: "진행 기관",
      type: "select",
      width: 170,
      options: [
        { id: "직접_미소", label: "직접_미소", color: "#ff007f", order: 0 },
        { id: "재단_인천,지방보증드림", label: "재단_인천,지방보증드림", color: "#401694", order: 1 },
        { id: "재단_경기사이버보증", label: "재단_경기사이버보증", color: "#9cd326", order: 2 },
        { id: "재단_서울보증", label: "재단_서울보증", color: "#7e3b8a", order: 3 },
        { id: "간접_소공인_대리", label: "간접_소공인_대리", color: "#cab641", order: 4 },
        { id: "소공인_대환", label: "소공인_대환", color: "#579bfc", order: 5 },
        { id: "소상공인_직접대출", label: "소상공인_직접대출", color: "#ff5ac4", order: 6 },
        { id: "직접_중진공", label: "직접_중진공", color: "#bb3354", order: 7 },
        { id: "간접_기보", label: "간접_기보", color: "#00c875", order: 8 },
        { id: "간접_신보", label: "간접_신보", color: "#037f4c", order: 9 },
        { id: "간접_농신보", label: "간접_농신보", color: "#fdab3d", order: 10 },
        { id: "간접_무보", label: "간접_무보", color: "#ffcb00", order: 11 },
        { id: "소공인_희링턴", label: "소공인_희링턴", color: "#ffadad", order: 12 },
        { id: "벤처인증", label: "벤처인증", color: "#7f5347", order: 13 },
        { id: "K-스타트업", label: "K-스타트업", color: "#784bd1", order: 14 },
        { id: "기업인증", label: "기업인증", color: "#333333", order: 15 },
        { id: "바우처", label: "바우처", color: "#007eb5", order: 16 },
        { id: "지원사업", label: "지원사업", color: "#563e3e", order: 17 },
      ],
    },
    {
      key: "dropdown_mm313ck5",
      label: "진행 상품",
      type: "multiselect",
      width: 180,
      options: PRODUCT_LABELS.map((label, order) => ({ id: label, label, order })),
    },
    {
      key: "color",
      label: "진행상항",
      type: "select",
      width: 180,
      options: [
        { id: "대기중", label: "대기중", color: GREY, order: 0 },
        { id: "진행중", label: "진행중", color: "#fdab3d", order: 1 },
        { id: "심사 중", label: "심사 중", color: "#ffcb00", order: 2 },
        { id: "승인", label: "승인", color: "#00c875", order: 3 },
        { id: "불가", label: "불가", color: "#ff007f", order: 4 },
        { id: "관리중", label: "관리중", color: "#007eb5", order: 5 },
        { id: "소공인(상생)", label: "소공인(상생)", color: "#bb3354", order: 6 },
        { id: "기업인증 진행", label: "기업인증 진행", color: "#579bfc", order: 7 },
        { id: "📂소진공 혁신성장 대기", label: "📂소진공 혁신성장 대기", color: "#df2f4a", order: 8 },
        { id: "📂소진공 신용취약 대기", label: "📂소진공 신용취약 대기", color: "#037f4c", order: 9 },
        { id: "📂소진공 일시적경영애로 대기", label: "📂소진공 일시적경영애로 대기", color: "#333333", order: 10 },
        { id: "📂소진공 재도전 대기", label: "📂소진공 재도전 대기", color: "#ff5ac4", order: 11 },
        { id: "해당연도 매출", label: "해당연도 매출", color: "#9d50dd", order: 12 },
        { id: "업체관리", label: "업체관리", color: "#cab641", order: 13 },
      ],
    },
    { key: "date_mkqp8y41", label: "방문 및 신청 일", type: "date", width: 130 },
    { key: "date0", label: "실사일", type: "date", width: 110 },
    { key: "____7", label: "지도내용", type: "longtext", width: null },
    { key: "numbers", label: "실행액", type: "number", width: 120 },
    { key: "dup__of____", label: "수수료(%)", type: "number", width: 100 },
    { key: "date3", label: "수수료_입금일", type: "date", width: 130 },
    { key: "date8", label: "재신청 안내일", type: "date", width: 130 },
    { key: "dup__of____3", label: "계약금", type: "number", width: 110 },
    { key: "date5", label: "계약금_입금일", type: "date", width: 130 },
  ],

  // 003 엔진의 field_type 에 대응이 없어 설치하지 않는다. 원문 수식을 남겨
  // PLAN-003 계산 엔진이 그대로 구현할 수 있게 한다.
  deferredColumns: [
    { key: "subitems", label: "하위 태스크", kind: "subtasks" },
    { key: "timerange8", label: "예상 심사기간", kind: "timeline" },
    { key: "__41", label: "수수료(원)", kind: "formula", source: "실행액 × 수수료(%) ÷ 100" },
    { key: "__1", label: "총 매출액", kind: "formula", source: "먼데이 원본 수식 — PLAN-003에서 재확인 필요" },
    { key: "formula", label: "D+180", kind: "formula", source: "수수료_입금일 + 180일" },
    { key: "formula0", label: "D+365", kind: "formula", source: "수수료_입금일 + 365일" },
  ],

  sections: [
    { name: "업무관리-준비단계", groupName: "⏹️준비단계", color: "#00c875", order: 0 },
    { name: "업무관리-진행중", groupName: "▶️진행중", color: "#BB3354", order: 1 },
    { name: "업무관리-심사 중", groupName: "🔂심사 중", color: "#9cd326", order: 2 },
    { name: "업무관리-승인", groupName: "💰승인", color: "#cab641", order: 3 },
    { name: "업무관리-소진공 취약자금 접수예정", groupName: "📂소진공 취약자금 접수예정", color: "#ffcb00", order: 4 },
    { name: "업무관리-소진공 혁신성장 접수예정", groupName: "📂소진공 혁신성장 접수예정", color: "#ffcb00", order: 5 },
    { name: "업무관리-소진공 일시적경영애로 접수예정", groupName: "📂소진공 일시적경영애로 접수예정", color: "#ffcb00", order: 6 },
    { name: "업무관리-소진공 재도전 접수예정", groupName: "📂소진공 재도전 접수예정", color: "#ffcb00", order: 7 },
    { name: "업무관리-기업인증 진행", groupName: "기업인증 진행", color: "#757575", order: 8 },
    { name: "업무관리-관리중", groupName: "관리중", color: "#FF5AC4", order: 9 },
    { name: "업무관리-대출불가", groupName: "대출불가", color: "#66CCFF", order: 10 },
  ],

  // 먼데이 실측 뷰 9종 중 테이블 뷰 7종. `캘린더`·`Vibe 뷰 만들기`는
  // 003 엔진의 view kind(table/kanban)에 대응이 없어 심지 않는다.
  // 각 뷰의 다중값 필터 조건은 WO-3 소유이므로 여기서는 이름·구조만 만든다.
  views: [
    { name: "재단_간접", kind: "table", shared: true },
    { name: "간접_소공인", kind: "table", shared: true },
    { name: "소공인 직접_취약", kind: "table", shared: true },
    { name: "소공인 직접_혁신성장", kind: "table", shared: true },
    { name: "소공인 직접_재도전", kind: "table", shared: true },
    { name: "소공인 직접_일시적", kind: "table", shared: true },
    { name: "중진공", kind: "table", shared: true },
  ],
};
