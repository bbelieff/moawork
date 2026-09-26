/**
 * document-ocr/limits — 파일·자원·시간 상한. 전부 로컬 강제이며 서버 전송은 없다.
 *
 * - 이미지는 JPEG/PNG/WebP만. PDF는 사업자등록증 첫 페이지만 사용한다.
 * - PDF 텍스트층이 충분하면 OCR을 생략하고(저비용·고정확), 부족하면
 *   첫 페이지 래스터 → OCR 폴백으로 간다.
 */

export const OCR_LIMITS = {
  /** 단일 파일 최대 15MB. */
  maxFileBytes: 15 * 1024 * 1024,
  /** PDF는 첫 페이지만. 나머지는 읽지 않는다. */
  maxPages: 1,
  /** PDF 텍스트층이 이 글자 수 이상이면 OCR 생략. */
  pdfTextMinChars: 30,
  /** 인식 입력 최대 변 (넘으면 축소). */
  maxImageDim: 3000,
  /** PDF 렌더 스케일 상한 (기기 메모리 보호). */
  pdfRenderScale: 2,
  /** 전체 OCR 파이프라인 제한 120초. */
  ocrTimeoutMs: 120_000,
  /** PDF 로드+렌더 제한 60초. */
  pdfTimeoutMs: 60_000,
  /** 같은-origin 에셋 기준 경로. 런타임 CDN 호출 금지. */
  assetBasePath: "/document-ocr",
} as const;

export const OCR_ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const OCR_ACCEPTED_TYPES = [
  ...OCR_ACCEPTED_IMAGE_TYPES,
  "application/pdf",
] as const;

export type OcrFileKind = "image" | "pdf";

export type OcrFileError = {
  code:
    | "empty"
    | "too-large"
    | "unsupported-type"
    | "too-many-pages"
    | "aborted"
    | "timeout"
    | "unavailable";
  message: string;
};

export function validateOcrFile(file: {
  size: number;
  type: string;
  name?: string;
}): { kind: OcrFileKind } | { error: OcrFileError } {
  if (!file || file.size <= 0) {
    return {
      error: { code: "empty", message: "빈 파일은 읽을 수 없습니다." },
    };
  }
  if (file.size > OCR_LIMITS.maxFileBytes) {
    return {
      error: {
        code: "too-large",
        message: `파일이 너무 큽니다. ${OCR_LIMITS.maxFileBytes / 1024 / 1024}MB 이하만 가능합니다.`,
      },
    };
  }
  const type = (file.type || "").toLowerCase();
  if ((OCR_ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type)) {
    return { kind: "image" };
  }
  if (type === "application/pdf") return { kind: "pdf" };
  // type이 비어 있는 브라우저를 위해 확장자로 한 번 더 본다.
  const name = (file.name || "").toLowerCase();
  if (/\.(jpe?g|png|webp)$/.test(name)) return { kind: "image" };
  if (/\.pdf$/.test(name)) return { kind: "pdf" };
  return {
    error: {
      code: "unsupported-type",
      message: "사업자등록증 이미지(JPEG·PNG·WebP) 또는 PDF만 가능합니다.",
    },
  };
}

/** AbortSignal + 타임아웃을 하나의 시그널로 묶는다. 정리용 dispose 포함. */
export function withTimeout(
  outer: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(outer?.reason ?? new DOMException("Aborted", "AbortError"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (outer) {
    if (outer.aborted) {
      controller.abort(outer.reason);
    } else {
      outer.addEventListener("abort", onAbort, { once: true });
    }
  }
  if (!controller.signal.aborted) {
    timer = setTimeout(() => {
      controller.abort(
        new DOMException(`시간 초과 (${Math.round(ms / 1000)}초)`, "TimeoutError"),
      );
    }, ms);
  }
  return {
    signal: controller.signal,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    },
  };
}

export function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

/**
 * 작업 promise와 abort를 race한다. terminate()/destroy()만으로는 대기 중인
 * promise가 끝나지 않을 수 있어(무한 대기) 취소 시그널 쪽에서 먼저 깨운다.
 * 이미 중단됐으면 즉시 거부한다. 어느 쪽이 이기든 리스너는 뗀다.
 */
export function raceWithAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    task.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * 실행 세대 gate — 같은 모달에서 파일을 다시 고르면(재오픈) 이전 실행의
 * 뒤늦은 완료가 새 화면 상태를 덮지 않게 한다. start() 토큰을 들고 있다가
 * settle 시점에 isCurrent(token)로 확인한다. AbortController와 함께 쓴다
 * (abort는 worker·대기를 끊고, gate는 상태 반영을 막는다).
 */
export function createOcrRunGate(): {
  start: () => number;
  isCurrent: (token: number) => boolean;
} {
  let seq = 0;
  let current = 0;
  return {
    start: () => {
      seq += 1;
      current = seq;
      return current;
    },
    isCurrent: (token: number) => token === current,
  };
}

export function toOcrFileError(error: unknown): OcrFileError {
  if (error instanceof DOMException) {
    if (error.name === "AbortError") {
      return { code: "aborted", message: "사용자가 취소했습니다." };
    }
    if (error.name === "TimeoutError") {
      return { code: "timeout", message: error.message || "시간이 초과됐습니다." };
    }
  }
  if (error instanceof Error) {
    if (/취소|abort/i.test(error.message)) {
      return { code: "aborted", message: "사용자가 취소했습니다." };
    }
    return { code: "unavailable", message: error.message };
  }
  return { code: "unavailable", message: "문서를 읽지 못했습니다." };
}
