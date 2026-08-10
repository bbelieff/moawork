// BBE-105 · 이중 잠금 게이트 — 공유 타입.
//
// 설계 원칙: 이 모듈은 "조건이 이미 평가된 값(satisfied)"만 안다.
// 그 값을 어떻게 얻는지(BBE-104 의 자동화 조건절(AND) 엔진이 채울 예정)는 모른다 —
// 호출부가 LockCondition[] 을 만들어 넘긴다. 그래서 BBE-104 완료 전에도 이 모듈은
// 완성할 수 있고, BBE-104 가 들어오면 그 판정 결과를 이 모양으로 매핑만 하면 된다.
// 경계: 영속성(DB 조회·쓰기)·보드별 UI는 별건. 이 모듈은 부수효과가 없다.

/** 게이트를 막고 있는(또는 통과시킨) 조건 1개. */
export interface LockCondition {
  /** 조건 식별자 — 감사 로그·"채우러 가기" 버튼 라우팅에 쓴다. */
  key: string;
  /** 사람이 읽는 조건 이름. 예: "대표 직인 승인". */
  label: string;
  /** 이 조건이 지금 충족됐는가. */
  satisfied: boolean;
  /** 현재 값의 표시 문자열. 예: "대기". 미입력이면 "미입력". */
  currentValueLabel: string;
}

/** 게이트 판정 입력. */
export interface LockGateInput {
  /** 회사 설정의 이중 잠금 스위치(D66). false 면 조건 미충족이어도 통과시킨다. */
  enabled: boolean;
  /** 이번 이관 시도에 걸린 조건 전부(AND). */
  conditions: readonly LockCondition[];
}

/** 게이트 판정 결과. */
export interface LockGateResult {
  /** 이관을 허용하는가. */
  passed: boolean;
  /** 조건은 미충족이었지만 스위치가 꺼져 있어 통과했는가(D66 감사 대상). */
  bypassed: boolean;
  /** 미충족 조건 목록(순서 보존) — 차단 사유 문구·"채우러 가기" 버튼 렌더링용. */
  unmet: readonly LockCondition[];
}

/** 이중 잠금 스위치 변경 요청(D66) — 끌 때만 사유가 필수다. */
export interface LockToggleRequest {
  /** 변경을 시도한 사람. */
  actor: string;
  /** 변경 후 상태. */
  enabled: boolean;
  /** 끌 때 필수, 켤 때는 비워도 된다. */
  reason: string | null;
}

/** 감사 로그에 남는 스위치 변경 기록. */
export interface LockToggleAudit {
  actor: string;
  enabled: boolean;
  /** 켤 때는 빈 문자열일 수 있다. 끌 때는 항상 비어 있지 않다. */
  reason: string;
  /** 호출부가 넘긴 시각(ISO). 이 모듈은 시계를 갖지 않는다(부수효과 없음). */
  at: string;
}

/** 스위치 변경 판정 실패. */
export interface LockToggleRejection {
  code: "reason_required";
  message: string;
}
