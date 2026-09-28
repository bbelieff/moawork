import { describe, expect, it } from "vitest";
import { OCR_LIMITS, raceWithAbort, validateOcrFile, withTimeout } from "./limits";
import { runDocumentOcr } from "./ocr-client";

function fakeFile(over: { size?: number; type?: string; name?: string } = {}) {
  return {
    size: over.size ?? 1024,
    type: over.type ?? "image/png",
    name: over.name ?? "cert.png",
  };
}

describe("limits", () => {
  it("이미지 3종과 PDF를 받는다", () => {
    expect(validateOcrFile(fakeFile({ type: "image/jpeg" }))).toEqual({ kind: "image" });
    expect(validateOcrFile(fakeFile({ type: "image/png" }))).toEqual({ kind: "image" });
    expect(validateOcrFile(fakeFile({ type: "image/webp" }))).toEqual({ kind: "image" });
    expect(validateOcrFile(fakeFile({ type: "application/pdf", name: "c.pdf" }))).toEqual({
      kind: "pdf",
    });
  });

  it("빈 파일·초과·미지원을 거부한다", () => {
    expect(validateOcrFile(fakeFile({ size: 0 }))).toMatchObject({
      error: expect.objectContaining({ code: "empty" }),
    });
    expect(
      validateOcrFile(fakeFile({ size: OCR_LIMITS.maxFileBytes + 1 })),
    ).toMatchObject({ error: expect.objectContaining({ code: "too-large" }) });
    expect(validateOcrFile(fakeFile({ type: "text/plain", name: "a.txt" }))).toMatchObject({
      error: expect.objectContaining({ code: "unsupported-type" }),
    });
  });

  it("type이 비어도 확장자로 구제한다", () => {
    expect(validateOcrFile(fakeFile({ type: "", name: "scan.PDF" }))).toEqual({
      kind: "pdf",
    });
  });

  it("withTimeout은 외부 취소를 전파하고 정리한다", () => {
    const c = new AbortController();
    const { signal, dispose } = withTimeout(c.signal, 60_000);
    expect(signal.aborted).toBe(false);
    c.abort();
    expect(signal.aborted).toBe(true);
    dispose();
  });
});

describe("raceWithAbort", () => {
  it("정상 완료는 그대로 통과한다", async () => {
    const c = new AbortController();
    await expect(raceWithAbort(Promise.resolve("done"), c.signal)).resolves.toBe("done");
  });

  it("작업 실패는 그대로 전달한다", async () => {
    const c = new AbortController();
    await expect(raceWithAbort(Promise.reject(new Error("boom")), c.signal)).rejects.toThrow(
      "boom",
    );
  });

  it("대기 중 abort는 무한 대기 없이 거부된다 (terminate 미반응 회귀)", async () => {
    const c = new AbortController();
    const pending = new Promise<string>(() => undefined);
    const raced = raceWithAbort(pending, c.signal);
    const assertion = expect(raced).rejects.toBeTruthy();
    c.abort(new DOMException("사용자가 취소했습니다.", "AbortError"));
    await assertion;
  });

  it("이미 중단된 시그널은 즉시 거부된다", async () => {
    const c = new AbortController();
    c.abort();
    await expect(raceWithAbort(Promise.resolve(1), c.signal)).rejects.toBeTruthy();
  });
});

describe("ocr-client (Node 가능 경로)", () => {
  it("검증 실패는 브라우저 없이도 코드와 함께 거부된다", async () => {
    await expect(
      runDocumentOcr(fakeFile({ size: 0 }) as unknown as File),
    ).rejects.toMatchObject({ code: "empty" });
    await expect(
      runDocumentOcr(fakeFile({ type: "text/plain", name: "a.txt" }) as unknown as File),
    ).rejects.toMatchObject({ code: "unsupported-type" });
  });

  it("사전 취소는 인식 진입 없이 중단된다", async () => {
    const c = new AbortController();
    c.abort();
    await expect(
      runDocumentOcr(fakeFile() as unknown as File, { signal: c.signal }),
    ).rejects.toBeTruthy();
  });
});
