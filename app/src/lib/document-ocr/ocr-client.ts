/**
 * document-ocr/ocr-client — 브라우저 전용 OCR 실행기.
 *
 * - 이 모듈은 tesseract.js / pdfjs-dist를 정적 import하지 않는다.
 *   (Next SSR 그래프 오염 방지. 모두 함수 내부 dynamic import.)
 * - 문서는 절대 네트워크로 나가지 않는다. worker·core·lang 에셋은
 *   same-origin `/document-ocr/*` 만 사용하고 런타임 CDN 호출은 없다.
 * - 취소(AbortSignal)·타임아웃·worker 종료·objectURL 해제를 보장한다.
 *
 * Node(vitest)에서는 파일 검증·사전 취소 경로까지만 테스트한다.
 * 실제 인식은 브라우저 픽스처 안내(OCR-RESULT.md)를 따른다.
 */

import {
  OCR_LIMITS,
  raceWithAbort,
  throwIfAborted,
  toOcrFileError,
  validateOcrFile,
  withTimeout,
} from "./limits";
import type { OcrProgress, OcrStage } from "./types";

export type OcrEngineText = {
  text: string;
  sourceKind: "ocr" | "pdf-text";
  /** 0~1. tesseract 평균 확신도(없으면 undefined). */
  confidence?: number;
};

export type RunOcrOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: OcrProgress) => void;
  /** 기본 "kor". "+eng"은 manifest에 있을 때만 추가된다. */
  langs?: string;
};

type Manifest = {
  package: string;
  tesseractJs: string;
  pdfjs: string;
  worker: string;
  core: string[];
  langs: string[];
  /** true면 `<lang>.traineddata.gz` 파일명으로 받는다 (best_int + gzip 벤더). */
  gzip?: boolean;
};

export type OcrAssetUrls = {
  workerPath: string;
  langPath: string;
  corePath: string;
  pdfWorkerSrc: string;
};

/**
 * manifest 파일명 → same-origin 에셋 URL. 전부 `assetBasePath` 아래여야 하며,
 * 하나라도 바깥(절대 URL·상위 경로·빈 값)이면 로컬 에셋 실패로 그대로 던진다.
 * 런타임 CDN 폴백은 없다 — 여기서 막지 않으면 tesseract가 기본 CDN worker를
 * 물어 조용히 외부 의존이 생긴다.
 */
export function buildOcrAssetUrls(manifest: Manifest): OcrAssetUrls {
  const base = OCR_LIMITS.assetBasePath;
  const inside = (entry: string | undefined): string | null => {
    if (!entry || typeof entry !== "string") return null;
    const clean = entry.trim();
    if (!clean || clean.includes("://") || clean.startsWith("//")) return null;
    const joined = clean.startsWith("/") ? clean : `${base}/${clean}`;
    if (!joined.startsWith(`${base}/`)) return null;
    if (joined.includes("..")) return null;
    return joined;
  };
  const workerPath = inside(manifest.worker);
  const corePath = inside(
    manifest.core?.[0] ? `tesseract/${manifest.core[0]}` : undefined,
  );
  const langPath = `${base}/tesseract`;
  const pdfWorkerSrc = inside("pdf.worker.min.mjs");
  if (!workerPath || !corePath || !pdfWorkerSrc) {
    throw new Error(
      "로컬 OCR 에셋이 올바르지 않습니다. 저장소 안내대로 `npm run vendor:document-ocr --workspace app`을 다시 실행하세요.",
    );
  }
  if (!manifest.langs || manifest.langs.length === 0) {
    throw new Error(
      "로컬 OCR 언어팩 목록이 비어 있습니다. `npm run vendor:document-ocr --workspace app`을 다시 실행하세요.",
    );
  }
  return { workerPath, langPath, corePath, pdfWorkerSrc };
}

function emit(
  onProgress: RunOcrOptions["onProgress"],
  stage: OcrStage,
  ratio: number,
  message: string,
) {
  onProgress?.({ stage, ratio, message });
}

function ensureBrowser(): void {
  if (typeof window === "undefined") {
    throw new Error("문서 OCR은 브라우저에서만 실행됩니다.");
  }
}

async function loadManifest(signal: AbortSignal): Promise<Manifest> {
  const res = await raceWithAbort(fetch(`${OCR_LIMITS.assetBasePath}/manifest.json`, {
    credentials: "same-origin",
    signal,
  }), signal);
  if (!res.ok) {
    throw new Error(
      "로컬 OCR 에셋이 없습니다. 저장소 안내대로 `npm run vendor:document-ocr --workspace app`을 먼저 실행하세요.",
    );
  }
  return (await raceWithAbort(res.json(), signal)) as Manifest;
}

function pickLangs(requested: string, available: string[]): string {
  const wants = requested
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = wants.filter((l) => available.includes(l));
  if (kept.length > 0) return kept.join("+");
  if (available.includes("kor")) return "kor";
  return available[0] ?? "kor";
}

/** 큰 이미지를 maxImageDim 이하로 축소한 PNG Blob. */
async function toCappedImageBlob(
  source: Blob,
  signal: AbortSignal,
): Promise<{ blob: Blob; objectUrls: string[] }> {
  const objectUrls: string[] = [];
  try {
    throwIfAborted(signal);
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(source);
      try {
        throwIfAborted(signal);
        const scale = Math.min(
          1,
          OCR_LIMITS.maxImageDim / Math.max(bitmap.width, bitmap.height),
        );
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return { blob: source, objectUrls };
        ctx.drawImage(bitmap, 0, 0, width, height);
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((b) => {
            if (b) resolve(b);
            else reject(new Error("이미지 변환에 실패했습니다."));
          }, "image/png");
        });
        canvas.width = 0;
        canvas.height = 0;
        return { blob, objectUrls };
      } finally {
        bitmap.close();
      }
    }
    return { blob: source, objectUrls };
  } catch (error) {
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    throw error;
  }
}

type TessWorker = {
  recognize: (
    image: TesseractImageLike,
    options?: Record<string, unknown>,
  ) => Promise<{ data: { text: string; confidence?: number } }>;
  terminate: () => Promise<void>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TesseractImageLike = any;

/**
 * 취소 가능한 worker 생성.
 *
 * `tess.createWorker()` 대기는 abort race가 없어 초기화가 영원히 걸리면
 * 취소·타임아웃이 먹지 않았다. 생성을 abort와 race하고,
 * abort가 먼저 이기면 뒤늦게 생긴 worker를 종료하고 버린다
 * (좀비 worker·늦은 resolve의 상태 오염 방지). 생성 자체가 실패하면
 * 그 오류를 그대로 던진다.
 */
export async function createCancellableWorker<W extends { terminate: () => Promise<void> }>(
  create: () => Promise<W>,
  signal: AbortSignal,
): Promise<W> {
  if (signal.aborted) throw signal.reason;
  const created = create();
  try {
    return await raceWithAbort(created, signal);
  } catch (error) {
    // abort 승 → 늦게 태어난 worker 정리. 생성 실패면 빈 reject라 무시된다.
    void created.then(
      (late) => late.terminate().catch(() => undefined),
      () => undefined,
    );
    throw error;
  }
}

async function recognizeBlob(
  blob: Blob,
  langs: string,
  manifest: Manifest,
  signal: AbortSignal,
  onProgress: RunOcrOptions["onProgress"],
): Promise<{ text: string; confidence?: number }> {
  const tess = (await import("tesseract.js")) as unknown as {
    createWorker: (
      langs?: string,
      oem?: number,
      options?: Record<string, unknown>,
    ) => Promise<TessWorker>;
  };
  // 고정 tesseract.js v7 — createWorker(langs, oem, options) 단일 호출만 쓴다.
  // 구 API 폴백(옵션 객체 단일 인자 호출)은 첫 인자를 langs로 읽어 기본 CDN
  // worker를 물게 되므로 삭제했다. 로컬 에셋이 깨지면 위에서 그대로 실패한다.
  const assets = buildOcrAssetUrls(manifest);
  const options = {
    workerPath: assets.workerPath,
    langPath: assets.langPath,
    corePath: assets.corePath,
    cacheMethod: "none",
    gzip: manifest.gzip ?? true,
    logger: (m: { status?: string; progress?: number }) => {
      if (m.status === "recognizing text" && typeof m.progress === "number") {
        emit(onProgress, "recognizing", 0.15 + m.progress * 0.8, "문자 인식 중");
      }
    },
  };
  let worker: TessWorker | undefined;
  const onAbort = () => {
    void worker?.terminate().catch(() => undefined);
  };
  if (signal.aborted) throw signal.reason;
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    throwIfAborted(signal);
    const langsToLoad = pickLangs(langs, manifest.langs);
    // 생성 대기도 abort와 race한다 — 초기화 hang에도 취소·타임아웃이 먹는다.
    worker = await createCancellableWorker(
      () => tess.createWorker(langsToLoad, undefined, options),
      signal,
    );
    throwIfAborted(signal);
    emit(onProgress, "recognizing", 0.15, "문자 인식 중");
    const objectUrl = URL.createObjectURL(blob);
    try {
      // terminate()만으로는 대기 중 recognize가 끝나지 않을 수 있어 abort와
      // race한다 (무한 대기 방지). settle 후 worker는 finally에서 종료한다.
      const result = await raceWithAbort(worker.recognize(objectUrl), signal);
      throwIfAborted(signal);
      return {
        text: result.data.text || "",
        confidence:
          typeof result.data.confidence === "number"
            ? result.data.confidence / 100
            : undefined,
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    await worker?.terminate().catch(() => undefined);
  }
}

async function readPdfTextLayer(
  file: Blob,
  signal: AbortSignal,
  onProgress: RunOcrOptions["onProgress"],
  pdfWorkerSrc: string,
): Promise<string | null> {
  const pdfjs = (await import("pdfjs-dist")) as unknown as {
    GlobalWorkerOptions: { workerSrc: string };
    getDocument: (src: { data: ArrayBuffer }) => PdfLoadingTask;
  };
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
  const buffer = await file.arrayBuffer();
  throwIfAborted(signal);
  // pdfjs v6: destroy()는 문서가 아니라 로딩 태스크에 있다.
  const loadingTask = pdfjs.getDocument({ data: buffer });
  let doc: PdfDocument | undefined;
  try {
    // 로딩 중 취소는 destroy로 태스크를 끊고 race로 대기를 깨운다.
    const onAbortDestroy = () => {
      void loadingTask.destroy?.().catch(() => undefined);
    };
    signal.addEventListener("abort", onAbortDestroy, { once: true });
    try {
      doc = await raceWithAbort(loadingTask.promise, signal);
    } finally {
      signal.removeEventListener("abort", onAbortDestroy);
    }
    throwIfAborted(signal);
    if (doc.numPages < 1) throw new Error("PDF에 페이지가 없습니다.");
    const page = await raceWithAbort(doc.getPage(1), signal);
    emit(onProgress, "pdf-text", 0.1, "PDF 텍스트층 읽는 중");
    const content = await raceWithAbort(page.getTextContent(), signal);
    const layerText = content.items
      .map((item) => item.str ?? "")
      .join("\n")
      .trim();
    if (layerText.replace(/\s+/g, "").length >= OCR_LIMITS.pdfTextMinChars) {
      return layerText;
    }
    return null;
  } finally {
    if (doc) await destroyPdfLoadingTask(loadingTask, doc);
    else await loadingTask.destroy?.().catch(() => undefined);
  }
}

export async function runDocumentOcr(
  file: File | Blob & { name?: string; type: string; size: number },
  opts: RunOcrOptions = {},
): Promise<OcrEngineText> {
  // 검증·취소는 브라우저 없이도 판정한다 (Node 테스트 가능 경로).
  const checked = validateOcrFile({
    size: file.size,
    type: file.type,
    name: (file as File).name,
  });
  if ("error" in checked) {
    throw Object.assign(new Error(checked.error.message), {
      code: checked.error.code,
    });
  }
  if (opts.signal?.aborted) throw opts.signal.reason;
  ensureBrowser();
  emit(opts.onProgress, "validating", 0.02, "파일 확인 중");
  const guard = withTimeout(opts.signal, OCR_LIMITS.ocrTimeoutMs);
  try {
    const manifest = await loadManifest(guard.signal);
    // 에셋 검증을 인식 시작 전에 끝낸다 — 깨진 로컬 에셋은 CDN으로
    // 넘어가지 않고 여기서 그대로 실패한다.
    const assets = buildOcrAssetUrls(manifest);
    throwIfAborted(guard.signal);
    if (checked.kind === "pdf") {
      // PDF 전용 타임아웃으로 텍스트층/렌더를 묶는다.
      const pdfGuard = withTimeout(guard.signal, OCR_LIMITS.pdfTimeoutMs);
      try {
        const layerText = await readPdfTextLayer(
          file as Blob,
          pdfGuard.signal,
          opts.onProgress,
          assets.pdfWorkerSrc,
        );
        if (layerText !== null) return { text: layerText, sourceKind: "pdf-text" };
      } finally {
        pdfGuard.dispose();
      }
      // 텍스트층이 부족하면 첫 페이지만 렌더해 OCR 폴백한다.
      const { blob } = await renderPdfFirstPageToBlob(
        file as Blob,
        guard.signal,
        opts.onProgress,
        assets.pdfWorkerSrc,
      );
      const capped = await toCappedImageBlob(blob, guard.signal);
      try {
        const out = await recognizeBlob(
          capped.blob,
          opts.langs ?? "kor",
          manifest,
          guard.signal,
          opts.onProgress,
        );
        return { text: out.text, sourceKind: "ocr", confidence: out.confidence };
      } finally {
        capped.objectUrls.forEach((u) => URL.revokeObjectURL(u));
      }
    }
    const capped = await toCappedImageBlob(file as Blob, guard.signal);
    try {
      const out = await recognizeBlob(
        capped.blob,
        opts.langs ?? "kor",
        manifest,
        guard.signal,
        opts.onProgress,
      );
      return { text: out.text, sourceKind: "ocr", confidence: out.confidence };
    } finally {
      capped.objectUrls.forEach((u) => URL.revokeObjectURL(u));
    }
  } catch (error) {
    const mapped = toOcrFileError(error);
    throw Object.assign(
      new Error(mapped.message),
      { code: mapped.code },
      error instanceof Error && (error as { code?: string }).code
        ? { code: (error as { code?: string }).code }
        : {},
    );
  } finally {
    guard.dispose();
    emit(opts.onProgress, "done", 1, "완료");
  }
}

async function renderPdfFirstPageToBlob(
  file: Blob,
  signal: AbortSignal,
  onProgress: RunOcrOptions["onProgress"],
  pdfWorkerSrc: string,
): Promise<{ blob: Blob }> {
  const pdfjs = (await import("pdfjs-dist")) as unknown as {
    GlobalWorkerOptions: { workerSrc: string };
    getDocument: (src: { data: ArrayBuffer }) => PdfLoadingTask;
  };
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
  const buffer = await file.arrayBuffer();
  throwIfAborted(signal);
  const loadingTask = pdfjs.getDocument({ data: buffer });
  let doc: PdfDocument | undefined;
  const onAbortDestroy = () => {
    void loadingTask.destroy?.().catch(() => undefined);
  };
  signal.addEventListener("abort", onAbortDestroy, { once: true });
  try {
    doc = await raceWithAbort(loadingTask.promise, signal);
    const page = await raceWithAbort(doc.getPage(1), signal);
    emit(onProgress, "pdf-render", 0.12, "PDF 첫 페이지 그리는 중");
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(
      OCR_LIMITS.pdfRenderScale,
      OCR_LIMITS.maxImageDim / Math.max(base.width, base.height),
    );
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("PDF를 그릴 수 없습니다.");
    await raceWithAbort(page.render({ canvasContext: ctx, viewport }).promise, signal);
    throwIfAborted(signal);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("PDF 페이지 변환에 실패했습니다."));
      }, "image/png");
    });
    canvas.width = 0;
    canvas.height = 0;
    return { blob };
  } finally {
    signal.removeEventListener("abort", onAbortDestroy);
    if (doc) await destroyPdfLoadingTask(loadingTask, doc);
    else await loadingTask.destroy?.().catch(() => undefined);
  }
}

/** pdfjs-dist v6 최소 타입. destroy()는 문서가 아니라 로딩 태스크에 있다. */
type PdfLoadingTask = {
  promise: Promise<{
    numPages: number;
    getPage: (n: number) => Promise<{
      getViewport: (opt: { scale: number }) => { width: number; height: number };
      getTextContent: () => Promise<{ items: { str?: string }[] }>;
      render: (opt: {
        canvasContext: CanvasRenderingContext2D;
        viewport: { width: number; height: number };
      }) => { promise: Promise<void> };
    }>;
  }>;
  destroy?: () => Promise<void>;
};

type PdfDocument = Awaited<PdfLoadingTask["promise"]> & {
  cleanup?: () => unknown;
};

async function destroyPdfLoadingTask(
  loadingTask: PdfLoadingTask,
  doc: PdfDocument,
): Promise<void> {
  try {
    if (typeof loadingTask.destroy === "function") {
      await loadingTask.destroy();
      return;
    }
  } catch {
    // 구버전 폴백으로 계속한다.
  }
  try {
    await doc.cleanup?.();
  } catch {
    // 정리 실패는 본 오류를 가리지 않는다.
  }
}
