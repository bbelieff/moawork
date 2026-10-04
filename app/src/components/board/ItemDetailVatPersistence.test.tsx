// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ load: vi.fn(), confirm: vi.fn() }));
let latestOcrProps: Record<string, unknown> | null = null;

vi.mock("@/app/(app)/boards/item-detail-vat-actions", () => ({
  loadItemVatPeriodsAction: actions.load,
  confirmItemVatPeriodsAction: actions.confirm,
}));
vi.mock("./ItemDetailVatOcr", () => ({
  ItemDetailVatOcr: (props: Record<string, unknown>) => {
    latestOcrProps = props;
    return <button type="button">OCR 제안 열기</button>;
  },
}));

import { ItemDetailVatPersistence } from "./ItemDetailVatPersistence";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const target = {
  boardId: "20000000-0000-4000-8000-000000000002",
  itemId: "30000000-0000-4000-8000-000000000003",
};
const sourceFileId = "40000000-0000-4000-8000-000000000004";
const empty = { version: 2, replayed: false, periods: [] };
const saved = {
  version: 3,
  replayed: false,
  periods: [{
    periodStart: "2025-01-01", periodEnd: "2025-06-30", salesAmount: "12345",
    sourceFileId, appliedVersion: 3,
  }],
};
const confirmation = {
  sourceFileId,
  documentBizNo: "1234567891",
  periods: [{ periodStart: "2025-01-01", periodEnd: "2025-06-30", salesAmount: "12345" }],
};

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const file = new File(["synthetic"], "vat.pdf", { type: "application/pdf" });
  await act(async () => root?.render(
    <ItemDetailVatPersistence {...target} file={file} sourceFileId={sourceFileId} expectedBizNo="1234567891" />,
  ));
  await flush();
  return file;
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  latestOcrProps = null;
  vi.restoreAllMocks();
});

beforeEach(() => {
  actions.load.mockReset().mockResolvedValue({ ok: true, data: empty, message: "loaded" });
  actions.confirm.mockReset();
});

describe("ItemDetailVatPersistence", () => {
  it("현재 대상의 readback을 먼저 읽고 같은 로컬 File/첨부 ID를 OCR에 보낸다", async () => {
    const file = await mount();
    expect(actions.load).toHaveBeenCalledWith(target);
    expect(latestOcrProps).toMatchObject({ file, sourceFileId, expectedBizNo: "1234567891" });
    expect(latestOcrProps?.onConfirm).toBeTypeOf("function");
    expect(host?.textContent).toContain("저장된 기간별 자료가 없습니다");
  });

  it("실패 재시도에는 같은 request UUID/CAS를 쓰고 성공 뒤 canonical readback만 표시한다", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("50000000-0000-4000-8000-000000000005");
    actions.confirm
      .mockResolvedValueOnce({ ok: false, code: "unavailable", error: "같은 요청으로 다시 시도해 주세요." })
      .mockResolvedValueOnce({ ok: true, data: saved, message: "선택한 기간별 자료를 저장했습니다." });
    await mount();
    const onConfirm = latestOcrProps?.onConfirm as (value: typeof confirmation) => Promise<unknown>;
    await act(async () => { await onConfirm(confirmation); });
    await act(async () => { await onConfirm(confirmation); });
    expect(actions.confirm).toHaveBeenCalledTimes(2);
    expect(actions.confirm.mock.calls[0]?.[0]).toEqual(actions.confirm.mock.calls[1]?.[0]);
    expect(actions.confirm).toHaveBeenCalledWith({
      ...target,
      requestId: "50000000-0000-4000-8000-000000000005",
      expectedVersion: 2,
      confirmation,
    });
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(host?.textContent).toContain("2025-01-01 ~ 2025-06-30 · 12345원");
  });

  it("read 연결이 없으면 업로드 성공을 되돌리지 않고 확정만 잠근다", async () => {
    actions.load.mockResolvedValue({ ok: false, code: "unavailable", error: "DB 저장 연결 없음" });
    await mount();
    expect(latestOcrProps?.onConfirm).toBeUndefined();
    expect(host?.textContent).toContain("DB 저장 연결 없음");
    expect(host?.textContent).toContain("저장 확정은 잠겨 있습니다");
    expect(actions.confirm).not.toHaveBeenCalled();
  });

  it("다른 첨부 ID를 가진 제안은 action 전에 거부한다", async () => {
    await mount();
    const onConfirm = latestOcrProps?.onConfirm as (value: typeof confirmation) => Promise<{ ok: boolean }>;
    await expect(onConfirm({ ...confirmation, sourceFileId: "foreign-file" })).resolves.toEqual({
      ok: false,
      message: "저장 연결 또는 첨부 파일을 다시 확인해 주세요. 첨부와 제안은 유지됩니다.",
    });
    expect(actions.confirm).not.toHaveBeenCalled();
  });
});
