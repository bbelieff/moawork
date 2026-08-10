/**
 * 보고선 계산 — **순수 로직**(DB 접근 없음. 조회는 server.ts 가 맡는다).
 *
 * 설계 정본: docs/design/조직·보고체계_설계_v1.md §1-3, §4-4
 * 부서 트리가 진짜고 보고선은 여기서 **계산**한다 — 저장하지 않는다.
 * 사람마다 보고 대상을 손으로 지정하지 않는다(D14). 손 지정은 §1-3 ① «예외»로만 남는다
 * (013 의 `member_hierarchy_assignments` 가 그 저장소 — 지금까지 아무도 읽지 않던
 * 쓰기 전용 경로였고, 이 모듈이 처음으로 그 값을 실제 입력으로 쓴다).
 *
 * 계산 규칙(§1-3):
 *   ① 예외 지정이 있으면 그 사람
 *   ② P 가 주부서의 장이면       → 상위 부서의 장
 *   ③ 아니면                     → 주부서의 장
 *   ④ 그 자리가 공석이면         → 한 단계 더 위로 (반복)
 *   ⑤ 최상위에 닿으면            → 소유자(보고 종료)
 *
 * 목업(UI목업_워크스페이스_최종_v6.html 의 reportsTo())은 시연용 단순화판이라
 * ①예외·⑤소유자-종착 을 구현하지 않는다 — 이 모듈은 문서로 지정된 **설계 정본**
 * (§1-3)을 따른다. 두 문서가 갈릴 때 알고리즘은 설계 문서, 화면 동작은 목업이 정본.
 */

export type DepartmentNode = {
  id: string;
  parentId: string | null;
  /** null = 공석. */
  headUserId: string | null;
};

export type ReportingContext = {
  departments: readonly DepartmentNode[];
  /** userId → 주부서 id. 미배정이면 null(또는 맵에 없음). */
  primaryDeptOf: ReadonlyMap<string, string | null>;
  /** userId → 예외 지정 대상(§1-3 ①). 지정 없음/해제는 null(또는 맵에 없음). */
  exceptionOf: ReadonlyMap<string, string | null>;
  ownerUserId: string;
};

function findDept(
  departments: readonly DepartmentNode[],
  id: string | null,
): DepartmentNode | null {
  if (id === null) return null;
  return departments.find((d) => d.id === id) ?? null;
}

/**
 * P 의 다음 보고 대상 한 명. 아무에게도 보고하지 않으면(자기가 최상위 소유자 본인)
 * null.
 */
export function resolveReportsTo(userId: string, ctx: ReportingContext): string | null {
  const owner = ctx.ownerUserId === userId ? null : ctx.ownerUserId;

  const exception = ctx.exceptionOf.get(userId);
  if (exception) return exception === userId ? owner : exception; // ①

  const myDeptId = ctx.primaryDeptOf.get(userId) ?? null;
  if (myDeptId === null) return owner; // 미배정 → 소유자(§1-2 "어느 부서에도 없으면… 소유자에게 보고")

  let dept = findDept(ctx.departments, myDeptId);
  // ② 내가 이 부서의 장이면 상위 부서부터 탐색 시작
  if (dept && dept.headUserId === userId) {
    dept = findDept(ctx.departments, dept.parentId);
  }
  // ③④ 아니면 내 부서부터 — 공석(또는 자기 자신)이면 한 단계씩 더 위로
  while (dept) {
    if (dept.headUserId && dept.headUserId !== userId) return dept.headUserId;
    dept = findDept(ctx.departments, dept.parentId);
  }
  return owner; // ⑤
}

/**
 * 보고가 올라가는 전체 경로(§2-2 스텝 수만큼 반복하거나, UI 미리보기용으로 끝까지).
 * 순환·자기참조가 섞여도 무한루프에 빠지지 않는다 — 이미 나온 사람이 다시 나오면 멈춘다.
 */
export function reportingChainOf(
  userId: string,
  ctx: ReportingContext,
  maxSteps = ctx.departments.length + ctx.primaryDeptOf.size + 1,
): string[] {
  const chain: string[] = [];
  let current = userId;
  for (let i = 0; i < maxSteps; i++) {
    const next = resolveReportsTo(current, ctx);
    if (!next || chain.includes(next)) break;
    chain.push(next);
    current = next;
  }
  return chain;
}

/**
 * 이 사람의 담당 건에 알림이 갈 대상 — «담당자 + 직속 상사»(D19).
 * 담당자가 없으면 호출측이 팀 전체로 대체한다(그 로직은 이 모듈 밖 — 팀 인원 나열은
 * server.ts 의 몫).
 */
export function notificationTargetsFor(userId: string, ctx: ReportingContext): string[] {
  const superior = resolveReportsTo(userId, ctx);
  return superior ? [userId, superior] : [userId];
}

/**
 * 부서를 newParentId 밑으로 옮기면 순환이 생기는가.
 * DB 트리거(departments_prevent_cycle)와 동일 규칙 — UI 가 요청을 보내기 전에
 * 즉시 막아 사용자에게 «저장 실패»로 알리지 않고 그 자리에서 알려준다.
 */
export function wouldCreateDepartmentCycle(
  departments: readonly DepartmentNode[],
  deptId: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return false;
  if (newParentId === deptId) return true;
  let cursor: string | null = newParentId;
  while (cursor !== null) {
    if (cursor === deptId) return true;
    cursor = findDept(departments, cursor)?.parentId ?? null;
  }
  return false;
}

/**
 * userId 에게 «candidateTarget 에게 보고하라»는 예외를 새로 걸면 순환이 생기는가.
 * 트리 경유 경로까지 섞여도 잡아낸다 — candidateTarget 부터 시작해 실제
 * resolveReportsTo 를 반복 실행해 userId 가 다시 나오는지 본다(순수 예외 체인만
 * 보는 게 아니라, 예외 한 단계 뒤 트리로 넘어가는 혼합 경로도 검사한다).
 */
export function wouldCreateReportingCycle(
  userId: string,
  candidateTarget: string,
  ctx: ReportingContext,
): boolean {
  if (candidateTarget === userId) return true;
  const probeCtx: ReportingContext = {
    ...ctx,
    exceptionOf: new Map(ctx.exceptionOf).set(userId, candidateTarget),
  };
  const maxSteps = ctx.departments.length + ctx.primaryDeptOf.size + 2;
  let current = candidateTarget;
  const seen = new Set<string>([userId]);
  for (let i = 0; i < maxSteps; i++) {
    if (seen.has(current)) return current === userId;
    seen.add(current);
    const next = resolveReportsTo(current, probeCtx);
    if (!next) return false;
    if (next === userId) return true;
    current = next;
  }
  return false;
}
