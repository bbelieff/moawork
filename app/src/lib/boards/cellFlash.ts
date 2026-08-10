// 셀 편집 오류의 1회성 전달(flash) — 순수 인코딩 계층.
//
// 배경: 보드 편집은 **클라이언트 JS 없이** 셀 단위 서버 액션 폼으로 동작한다
// (GenericBoardTable 주석 참고). 그래서 `useActionState` 같은 클라이언트 상태를
// 쓰지 않고, 서버 액션이 남긴 쿠키를 다음 렌더에서 서버 컴포넌트가 읽어 표시한다.
//
// 왜 쿠키인가 — 대안과 비교:
//  - URL 쿼리: 오류 메시지에 사용자가 입력한 값이 섞인다. 주소창·리퍼러·로그에
//    남으므로 값이 새는 면이 넓어진다.
//  - 클라이언트 상태: 이 화면의 "JS 없이 동작" 성질을 깨뜨린다.
// 쿠키는 httpOnly + 짧은 TTL 로 두면 화면 밖으로 나가지 않는다.
//
// 소멸: 서버 컴포넌트 렌더 중에는 쿠키를 지울 수 없다(Next 제약). 그래서 **짧은
// TTL 로 스스로 사라지게** 한다. 표시 후 남아도 몇 초 뒤 만료된다.

/** 플래시 쿠키 이름. */
export const CELL_FLASH_COOKIE = "mw_cell_err";

/** 쿠키 수명(초). 다음 렌더에서 읽히기만 하면 되므로 짧게 둔다. */
export const CELL_FLASH_MAX_AGE = 10;

/** 쿠키에 담을 최대 인코딩 길이(헤더 비대 방지). */
const MAX_ENCODED_LENGTH = 1500;

/**
 * 메시지 1건의 최대 길이 — 사용자 입력이 섞이므로 상한을 둔다.
 *
 * ⚠ 글자 수 ≠ 인코딩 길이다. 한글은 `encodeURIComponent` 에서 글자당 9자
 * (`%EA%B0%80`)로 부푼다 — 120자면 최대 1080자. 그래서 이 상한만으로는
 * `MAX_ENCODED_LENGTH` 를 보장하지 못하고, 아래 인코딩 루프가 실제 길이를 보고
 * 더 줄인다.
 */
const MAX_MESSAGE_LENGTH = 120;

export type CellFlashError = {
  /** 컬럼 key — 어느 셀 아래에 표시할지. */
  key: string;
  /** 컬럼 라벨(표시용). */
  label: string;
  /** 사용자에게 보여줄 사유. */
  message: string;
};

export type CellFlash = {
  /** 오류가 난 아이템(행) id. */
  itemId: string;
  errors: CellFlashError[];
};

function clamp(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function encodePayload(itemId: string, errors: CellFlashError[]): string {
  return encodeURIComponent(JSON.stringify({ itemId, errors } satisfies CellFlash));
}

/**
 * 플래시를 쿠키 값으로 직렬화. 담을 것이 없으면 `null`.
 *
 * 크기 초과는 **버리지 않고 줄여서** 담는다 — 오류를 알리려다 오히려 아무것도
 * 안 보이는 상황을 피하려는 것이다. 순서:
 *  1) 뒤쪽 오류부터 덜어낸다(앞선 셀이 사용자가 방금 만진 셀일 가능성이 높다).
 *  2) 하나만 남았는데도 크면 그 메시지를 잘라 넣는다.
 * 그래도 안 들어가면(비정상적으로 긴 key·label) 그때만 `null`.
 */
export function encodeCellFlash(flash: CellFlash): string | null {
  const itemId = clamp(flash.itemId, 64);
  if (!itemId || flash.errors.length === 0) return null;

  const errors: CellFlashError[] = flash.errors.map((e) => ({
    key: clamp(e.key, 64),
    label: clamp(e.label, 64),
    message: clamp(e.message, MAX_MESSAGE_LENGTH),
  }));

  // 1) 뒤에서부터 덜어내며 들어갈 때까지 시도.
  for (let count = errors.length; count > 0; count--) {
    const encoded = encodePayload(itemId, errors.slice(0, count));
    if (encoded.length <= MAX_ENCODED_LENGTH) return encoded;
  }

  // 2) 첫 오류 하나도 안 들어간다 → 메시지를 이진 탐색으로 줄인다.
  const first = errors[0];
  let lo = 0;
  let hi = first.message.length;
  let best: string | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = encodePayload(itemId, [{ ...first, message: first.message.slice(0, mid) }]);
    if (candidate.length <= MAX_ENCODED_LENGTH) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * 쿠키 값 → 플래시. 형식이 어긋나면 `null`(표시하지 않는다).
 * 쿠키는 사용자가 조작할 수 있으므로 **구조를 신뢰하지 않고** 전부 검사한다.
 */
export function decodeCellFlash(raw: string | undefined | null): CellFlash | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const itemId = clamp(obj.itemId, 64);
  if (!itemId || !Array.isArray(obj.errors)) return null;

  const errors: CellFlashError[] = [];
  for (const entry of obj.errors) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const key = clamp(e.key, 64);
    const message = clamp(e.message, MAX_MESSAGE_LENGTH);
    if (!key || !message) continue;
    errors.push({ key, label: clamp(e.label, 64) || key, message });
  }

  return errors.length > 0 ? { itemId, errors } : null;
}

/** 특정 셀(행+컬럼)의 오류 메시지. 없으면 `null`. */
export function findCellError(
  flash: CellFlash | null,
  itemId: string,
  columnKey: string,
): string | null {
  if (!flash || flash.itemId !== itemId) return null;
  return flash.errors.find((e) => e.key === columnKey)?.message ?? null;
}
