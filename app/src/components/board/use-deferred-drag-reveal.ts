"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 행 끌기 중 «접힌 빈 그룹 펼치기» 를 dragstart 가 끝난 **다음 작업**으로 미룬다 (#845).
 *
 * 왜 미루나: Chromium·WebKit 은 dragstart 를 보낸 직후, 같은 작업 안에서 처음 누른 자리를
 * 다시 hit-test 한다(DragController::StartDrag). 끌던 요소가 그 자리에 없으면 끌기를 시작하지
 * 않고 곧바로 dragend 를 보낸다. React 는 dragstart 안의 setState 를 그 사이(마이크로태스크)에
 * 화면에 반영하므로, dragstart 에서 위쪽 빈 그룹을 펼치면 끌던 행이 아래로 밀려 끌기가
 * 취소된다. setTimeout(0) 은 그 작업이 끝난 뒤 — 끌기가 이미 시작된 뒤 — 에 돈다.
 *
 * `schedule()` 은 dragstart 에서, `cancel()` 은 dragend·drop 에서 부른다. 끌기가 곧바로
 * 취소돼 dragend 가 먼저 오면 예약을 지워 펼치지 않는다.
 */
export function useDeferredDragReveal(): {
  revealed: boolean;
  schedule: () => void;
  cancel: () => void;
} {
  const [revealed, setRevealed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const schedule = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setRevealed(true);
    }, 0);
  }, [clearTimer]);

  const cancel = useCallback(() => {
    clearTimer();
    setRevealed(false);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return { revealed, schedule, cancel };
}
