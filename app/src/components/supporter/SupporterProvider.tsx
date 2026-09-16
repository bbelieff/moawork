"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  isUnconfiguredSupporterStatus,
  type SupporterMode,
} from "@/lib/supporter/contracts";

export type { SupporterMode };

export interface SupporterMessage {
  id: number;
  from: "me" | "supporter";
  text: string;
}

export interface ThreadState {
  messages: SupporterMessage[];
  draft: string;
  pending: boolean;
  /**
   * 연결 없음 안내 — 가짜 서포터 말풍선이 아니라 명시적 상태로 둔다.
   * 초안은 그대로 보존된다.
   */
  error: string | null;
}

const EMPTY_THREAD: ThreadState = {
  messages: [],
  draft: "",
  pending: false,
  error: null,
};

/** 작업 요청 한 줄이 200자에는 턱없이 모자라 2000자로 둔다. 카운터를 함께 보여준다. */
export const SUPPORTER_INPUT_MAX_LENGTH = 2000;

/** contextKey(회사 ID 또는 "platform") + mode 별 기록 키. */
export function supporterThreadKey(
  contextKey: string,
  mode: SupporterMode,
): string {
  return `${contextKey}::${mode}`;
}

/** 전송 가능 여부 — 전송 중 같은 요청의 중복 제출을 막는다. */
export function canSubmitSupporterInput(input: {
  pending: boolean;
  text: string;
}): boolean {
  return !input.pending && input.text.trim().length > 0;
}

/**
 * 늦은 in-flight 응답 차단 — 요청 당시 epoch 와 현재 epoch 가 다르면 버린다.
 * 실제 전송 경로가 생기기 전에는 단위 테스트로만 검증되는 가드다.
 */
export function isStaleSupporterReply(
  replyEpoch: number,
  currentEpoch: number,
): boolean {
  return replyEpoch !== currentEpoch;
}

/**
 * 상태 조회 transport. true = 서버가 최소 메타데이터(unavailable/not_configured)를
 * 엄격한 계약으로 검증했다는 뜻. 기본값은 실제 `/api/supporter/status` fetch,
 * 합성 픽스처에서만 주입 stub 으로 바꾼다. 운영 배선은 절대 주입하지 않는다.
 */
export type SupporterStatusTransport = (
  mode: SupporterMode,
  signal: AbortSignal,
) => Promise<boolean>;

/**
 * 기본 transport — ok + JSON content-type + 엄격 계약이 셋 다 맞을 때만 true.
 * 미인증 리다이렉트의 HTML 200·찌꺼기 필드 본문을 승인으로 믿지 않는다.
 * json 파싱 뒤에도 abort 여부를 다시 본다.
 */
export async function defaultSupporterStatusTransport(
  mode: SupporterMode,
  signal: AbortSignal,
): Promise<boolean> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
  let response: Response;
  try {
    response = await fetch(`/api/supporter/status?mode=${mode}`, { signal: requestSignal, cache: "no-store" });
  } catch {
    return false;
  }
  if (requestSignal.aborted) return false;
  if (!response.ok || response.redirected) return false;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return false;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return false;
  }
  if (requestSignal.aborted) return false;
  return isUnconfiguredSupporterStatus(body);
}

interface SupporterContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  mode: SupporterMode;
  setMode: (mode: SupporterMode) => void;
  /** 운영서포터 UI 를 "보여도 되는 화면"인지. 권한 자체가 아니라 표면 조건이다. */
  allowOperations: boolean;
  /** 서버가 검증한 운영 컨텍스트. null = 미확인, false = 거부/미연결. */
  operationsGranted: boolean | null;
  thread: ThreadState;
  setDraft: (draft: string) => void;
  /** 연결 없음 안내 + 초안 보존. 가짜 성공 답변을 만들지 않는다. */
  submitNotConfigured: (text: string) => void;
  /** 운영 세션 슬롯 안내 — 세션 id 를 넣지 않는다. */
  sessionNotice: string | null;
  requestSessionNotice: () => void;
  openerRef: RefObject<HTMLButtonElement | null>;
  statusLine: string;
}

const SupporterContext = createContext<SupporterContextValue | null>(null);

export function useSupporter(): SupporterContextValue {
  const value = useContext(SupporterContext);
  if (!value) throw new Error("useSupporter must be used inside SupporterProvider");
  return value;
}

export const NOT_CONFIGURED_GUIDANCE =
  "AI 연결 준비 중이라 아직 실행되지 않았어요. 입력 내용은 그대로 두었어요.";

/**
 * 연결 없음 제출의 순수 전이 — 사용자 말풍선 하나 + 명시적 error 상태.
 * 초안을 보존하고, 가짜 서포터 답변 말풍선을 만들지 않는다.
 * 제출할 때마다 같은 안내 말풍선이 복제되던 동작을 고친다.
 */
export function applyNotConfiguredSubmit(
  thread: ThreadState,
  text: string,
): ThreadState {
  const value = text.slice(0, SUPPORTER_INPUT_MAX_LENGTH);
  if (!canSubmitSupporterInput({ pending: thread.pending, text: value })) {
    return thread;
  }
  return {
    ...thread,
    draft: value,
    error: NOT_CONFIGURED_GUIDANCE,
    messages: [...thread.messages, { id: nextMessage(), from: "me" as const, text: value }],
  };
}

let messageId = 0;
function nextMessage(): number {
  messageId += 1;
  return messageId;
}

/**
 * 서포터 상태 소유자. 기록·입력은 페이지 상태(React state)에만 둔다 —
 * localStorage·sessionStorage 에 민감 기록을 저장하지 않는다.
 * 사용자 입력 원문은 어떤 로그에도 남기지 않는다.
 */
export function SupporterProvider({
  contextKey,
  allowOperations,
  initialOpen = false,
  statusTransport,
  children,
}: {
  contextKey: string;
  allowOperations: boolean;
  initialOpen?: boolean;
  /** 합성 픽스처 전용 주입. 운영 화면(layout/PlatformShell)은 넘기지 않는다. */
  statusTransport?: SupporterStatusTransport;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [modeState, setModeState] = useState<SupporterMode>("user");
  // 컨텍스트별 승인 기록 — 렌더 직전에 contextKey 로 걸러서
  // 전환 직후 한 프레임도 이전 컨텍스트의 승인이 번쩍이지 않는다.
  const [opsGrant, setOpsGrant] = useState<{
    key: string;
    granted: boolean;
  } | null>(null);
  const [threads, setThreads] = useState<Record<string, ThreadState>>({});
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [userStatusLine, setStatusLine] = useState("AI 연결 준비 중");
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const epochRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [lastScope, setLastScope] = useState({ contextKey, allowOperations });

  // Reset during render when server scope changes, before children can receive
  // another identity's mode or draft. Effect cleanup aborts the old request.
  if (lastScope.contextKey !== contextKey || lastScope.allowOperations !== allowOperations) {
    setLastScope({ contextKey, allowOperations });
    setThreads({});
    setModeState("user");
    setOpsGrant(null);
    setSessionNotice(null);
  }

  // allowOperations 가 떨어지면 그 즉시 안전한 user 로 읽는다 —
  // effect 가 돌기 전 한 프레임도 운영 기록·토글이 노출되지 않는다.
  const operationsGranted =
    allowOperations && opsGrant?.key === contextKey ? opsGrant.granted : null;
  const mode: SupporterMode = operationsGranted === true ? modeState : "user";
  const statusLine = mode === "operations" ? "AI 연결 준비 중" : userStatusLine;

  // 렌더는 항상 현재 prop 키로 읽는다 — 리셋 effect 가 돌기 전 한 프레임도
  // 이전 회사 기록이 노출되지 않는다.
  const key = supporterThreadKey(contextKey, mode);
  const thread = threads[key] ?? EMPTY_THREAD;

  // 패널이 열려 있으면 서버 검증 상태를 확인한다. 운영 권한은 현재 모드와
  // 무관하게 미리 조회한다 — 초기 모드가 user 라서 operations 조회가
  // 뒤로 밀리면 토글이 영원히 안 뜨는 교착에 빠진다.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const myEpoch = epochRef.current;
    const live = () =>
      !controller.signal.aborted && myEpoch === epochRef.current;
    async function check() {
      const transport = statusTransport ?? defaultSupporterStatusTransport;
      const [userOk, opsOk] = await Promise.all([
        Promise.resolve().then(() => transport("user", controller.signal)).catch(() => false),
        allowOperations
          ? Promise.resolve().then(() => transport("operations", controller.signal)).catch(() => false)
          : Promise.resolve(false),
      ]);
      if (!live()) return;
      if (allowOperations) {
        setOpsGrant({ key: contextKey, granted: opsOk });
      }
      setStatusLine(userOk ? "AI 연결 준비 중" : "연결 상태를 확인할 수 없어요");
    }
    void check();
    return () => {
      controller.abort();
    };
  }, [open, allowOperations, contextKey, statusTransport]);

  const setDraft = useCallback(
    (draft: string) => {
      const capped = draft.slice(0, SUPPORTER_INPUT_MAX_LENGTH);
      setThreads((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? EMPTY_THREAD), draft: capped, error: null },
      }));
    },
    [key],
  );

  const setMode = useCallback(
    (next: SupporterMode) => {
      if (next === "operations" && (!allowOperations || operationsGranted !== true)) {
        return;
      }
      abortRef.current?.abort();
      epochRef.current += 1;
      setSessionNotice(null);
      setModeState(next);
    },
    [allowOperations, operationsGranted],
  );

  const submitNotConfigured = useCallback(
    (text: string) => {
      if (!canSubmitSupporterInput({ pending: thread.pending, text })) return;
      setThreads((prev) => ({
        ...prev,
        [key]: applyNotConfiguredSubmit(prev[key] ?? EMPTY_THREAD, text),
      }));
    },
    [key, thread.pending],
  );

  const requestSessionNotice = useCallback(() => {
    setSessionNotice("개발 세션 연결이 필요해요. 아직 대화를 불러오지 않았어요.");
  }, []);

  const value = useMemo<SupporterContextValue>(
    () => ({
      open,
      setOpen,
      mode,
      setMode,
      allowOperations,
      operationsGranted,
      thread,
      setDraft,
      submitNotConfigured,
      sessionNotice,
      requestSessionNotice,
      openerRef,
      statusLine,
    }),
    [
      open,
      mode,
      setMode,
      allowOperations,
      operationsGranted,
      thread,
      setDraft,
      submitNotConfigured,
      sessionNotice,
      requestSessionNotice,
      statusLine,
    ],
  );

  return (
    <SupporterContext.Provider value={value}>
      {children}
    </SupporterContext.Provider>
  );
}
