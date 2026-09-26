import { afterEach, describe, expect, it, vi } from "vitest";
import { runDocumentOcr } from "./ocr-client";
import { OCR_LIMITS } from "./limits";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const file = () => new Blob(["synthetic"], { type: "image/png" });
describe("OCR manifest cancellation", () => {
  it.each(["fetch", "json"])("interrupts a stalled %s before the worker starts", async (stage) => {
    vi.stubGlobal("window", {});
    const never = new Promise<never>(() => {});
    const fetcher = vi.fn(() => stage === "fetch" ? never : Promise.resolve({ ok: true, json: () => never }));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const result = runDocumentOcr(file(), { signal: controller.signal });
    const assertion = expect(result).rejects.toThrow("사용자가 취소했습니다.");
    await Promise.resolve(); await Promise.resolve();
    controller.abort(new DOMException("사용자 취소", "AbortError"));
    await assertion;
    expect(fetcher.mock.calls[0]).toBeDefined();
  });
  it("ends a stalled manifest at the overall OCR timeout", async () => {
    vi.useFakeTimers(); vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", vi.fn(() => new Promise<never>(() => {})));
    const assertion = expect(runDocumentOcr(file())).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(OCR_LIMITS.ocrTimeoutMs);
    await assertion;
  });
});
