/**
 * 「＋ 업체 추가」의 결과 — 화면이 «무엇이 잘못됐는지» 말할 수 있게 하는 계약.
 *
 * ★ 왜 void 가 아닌가.
 *   처음에는 서버 액션이 모든 실패를 catch 해서 void 를 돌려줬다. 근거는
 *   「실패를 성공으로 위장하지 않는다 — 다시 그리면 새 건이 없다」였는데,
 *   그건 «위장하지 않았다» 일 뿐 «알려줬다» 가 아니다. 사용자에게 보이는 것은
 *   눌렀는데 아무 일도 안 일어나는 화면이고, 그러면 또 누른다.
 *
 *   이 화면이 실제로 만나는 실패는 넷이고 처방이 전부 다르다(117 마이그레이션):
 *     · deal pipeline unavailable  — 파이프라인이 아직 없다. 첫 사용 경로다
 *     · permission denied          — 이 사람에게 권한이 없다
 *     · company unavailable        — 병합됐거나 조회 범위 밖의 회사다
 *     · 멱등 열쇠 재사용(22023)     — 같은 열쇠를 다른 회사로 다시 썼다
 *   「실패했습니다」 하나로 뭉치면 넷 다 같은 막다른 길이 된다.
 */
export interface CompanyIntakeResult {
  /** 사람이 읽고 다음 행동을 정할 수 있는 문장. 성공이면 null. */
  error: string | null;
  /**
   * 제출할 때마다 바뀌는 값. 화면이 이걸 key 로 써서 멱등 열쇠 입력칸을 새로 만든다 —
   * 한 번 쓴 열쇠를 다음 선택이 물려받으면 그 선택이 22023 으로 거절된다.
   */
  stamp: number;
}

export const EMPTY_INTAKE_RESULT: CompanyIntakeResult = { error: null, stamp: 0 };

/**
 * 저장소가 던진 원문을 사람 말로 바꾼다.
 *
 * ★ 원문을 그대로 보여주지 않는다 — 스키마 이름·제약 이름이 화면에 새는 것을 막고,
 *   사용자가 «무엇을 해야 하는지» 를 읽게 한다.
 */
export function describeIntakeFailure(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause ?? "");
  const text = raw.toLowerCase();

  if (text.includes("pipeline")) {
    return "이 회사에 아직 진행 단계가 준비되지 않았습니다. 온보딩에서 기본 구조를 먼저 설치해 주세요.";
  }
  if (text.includes("permission") || text.includes("42501")) {
    return "업무를 시작할 권한이 없습니다. 조직관리에서 권한을 받은 뒤 다시 시도해 주세요.";
  }
  if (text.includes("company unavailable")) {
    return "이 업체를 지금 쓸 수 없습니다. 다른 업체로 합쳐졌거나 열람 범위 밖일 수 있습니다.";
  }
  if (text.includes("idempotency")) {
    return "방금 요청과 겹쳤습니다. 목록을 다시 열고 한 번만 눌러 주세요.";
  }
  return "업무를 시작하지 못했습니다. 잠시 뒤 다시 시도하고, 계속 안 되면 이 화면을 알려 주세요.";
}
