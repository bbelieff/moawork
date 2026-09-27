import { describe, expect, it, vi } from "vitest";
import { createCancellableWorker } from "./ocr-client";
import { createOcrRunGate } from "./limits";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeWorker() {
  return { terminate: vi.fn(async () => undefined) };
}

describe("createCancellableWorker — 생성 hang에도 취소가 먹는다", () => {
  it("영원히 안 끝나는 생성 + 취소 → abort 사유로 거부된다", async () => {
    const create = vi.fn(() => new Promise<{ terminate: () => Promise<void> }>(() => {}));
    const controller = new AbortController();
    const pending = createCancellableWorker(create, controller.signal);
    const settled = vi.fn();
    void pending.then(settled, settled);
    controller.abort(new DOMException("사용자 취소", "AbortError"));
    await expect(pending).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("취소 뒤 늦게 생긴 worker는 종료하고 버린다", async () => {
    const gate = deferred<{ terminate: () => Promise<void> }>();
    const create = vi.fn(() => gate.promise);
    const controller = new AbortController();
    const pending = createCancellableWorker(create, controller.signal);
    const outcome = pending.then(
      () => "resolved",
      (error: unknown) => error,
    );
    controller.abort(new DOMException("사용자 취소", "AbortError"));
    await expect(outcome).resolves.toBeInstanceOf(DOMException);
    // 늦은 resolve — 호출자는 이미 거부됐고 worker는 정리된다.
    const late = fakeWorker();
    gate.resolve(late);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(late.terminate).toHaveBeenCalledTimes(1);
  });

  it("정상 생성은 worker를 그대로 돌리고 terminate하지 않는다", async () => {
    const worker = fakeWorker();
    const controller = new AbortController();
    const out = await createCancellableWorker(async () => worker, controller.signal);
    expect(out).toBe(worker);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("이미 중단됐으면 생성하지 않고 즉시 거부한다", async () => {
    const create = vi.fn(async () => fakeWorker());
    const controller = new AbortController();
    controller.abort(new DOMException("사전 취소", "AbortError"));
    await expect(createCancellableWorker(create, controller.signal)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it("생성 자체 실패는 그 오류 그대로 (abort 아님)", async () => {
    const create = vi.fn(async () => {
      throw new Error("로컬 에셋 없음");
    });
    const controller = new AbortController();
    await expect(createCancellableWorker(create, controller.signal)).rejects.toThrow(
      "로컬 에셋 없음",
    );
  });
});

describe("createOcrRunGate — 재오픈 시 이전 완료가 상태를 덮지 않는다", () => {
  it("새 실행이 시작되면 이전 토큰은 stale이 된다", () => {
    const gate = createOcrRunGate();
    const oldRun = gate.start();
    expect(gate.isCurrent(oldRun)).toBe(true);
    // 사용자가 다른 파일을 고름 (재오픈) — 이전 실행은 abort됐지만
    // 뒤늦게 settle할 수 있다.
    const newRun = gate.start();
    expect(newRun).not.toBe(oldRun);
    expect(gate.isCurrent(oldRun)).toBe(false);
    expect(gate.isCurrent(newRun)).toBe(true);
  });
});
