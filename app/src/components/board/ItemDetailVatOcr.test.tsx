// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/document-ocr/ocr-client", () => ({ runDocumentOcr: mocks.run }));

import { formatVatAmount, ItemDetailVatOcr, vatBizNumberMatch } from "./ItemDetailVatOcr";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  mocks.run.mockReset();
});

function vatText(bizNo = "123-45-67891") {
  return [
    `사업자등록번호 ${bizNo}`,
    "과세기간 2025.01.01 ~ 2025.06.30 매출액 12,345원",
    "과세기간 2025.07.01 ~ 2025.12.31 매출액 67,890원",
  ].join("\n");
}

async function render(onConfirm?: (input: unknown) => Promise<{ ok: boolean; message: string }>, expectedBizNo = "1234567891") {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const file = new File(["synthetic"], "vat-proof.pdf", { type: "application/pdf" });
  await act(async () => root?.render(
    <ItemDetailVatOcr file={file} sourceFileId="file-a" expectedBizNo={expectedBizNo} onConfirm={onConfirm} />,
  ));
  return { file };
}

describe("ItemDetailVatOcr", () => {
  it("업로드에 쓴 같은 File을 로컬 OCR에 넘기고 다기간 제안을 표시한다", async () => {
    mocks.run.mockResolvedValue({ text: vatText(), sourceKind: "pdf-text" });
    const { file } = await render();
    await act(async () => host?.querySelector<HTMLButtonElement>("button")?.click());
    expect(mocks.run).toHaveBeenCalledWith(file);
    expect(host?.textContent).toContain("2025-01-01 ~ 2025-06-30");
    expect(host?.textContent).toContain("12,345원");
    expect(host?.textContent).toContain("저장 연결은 다음 단계에서 열립니다");
    expect([...host!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("2개 확정"))?.disabled).toBe(true);
  });

  it("번호가 다르면 명시 확정과 콜백을 fail-closed로 막는다", async () => {
    mocks.run.mockResolvedValue({ text: vatText("123-45-67890"), sourceKind: "ocr" });
    const onConfirm = vi.fn().mockResolvedValue({ ok: true, message: "saved" });
    await render(onConfirm);
    await act(async () => host?.querySelector<HTMLButtonElement>("button")?.click());
    expect(host?.textContent).toContain("달라 확정할 수 없습니다");
    expect(host?.querySelector<HTMLInputElement>('input[type="checkbox"]:not([aria-label])')?.disabled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("일치한 번호와 명시 확인 뒤 선택한 행만 콜백 seam으로 보낸다", async () => {
    mocks.run.mockResolvedValue({ text: vatText(), sourceKind: "ocr" });
    const onConfirm = vi.fn().mockResolvedValue({ ok: true, message: "확정했습니다." });
    await render(onConfirm);
    await act(async () => host?.querySelector<HTMLButtonElement>("button")?.click());
    const rowChecks = [...host!.querySelectorAll<HTMLInputElement>('input[aria-label$="반영"]')];
    await act(async () => rowChecks[1].click());
    const explicit = host!.querySelector<HTMLInputElement>('input[type="checkbox"]:not([aria-label])')!;
    await act(async () => explicit.click());
    const submit = [...host!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("1개 확정"))!;
    await act(async () => submit.click());
    expect(onConfirm).toHaveBeenCalledWith({
      sourceFileId: "file-a",
      documentBizNo: "123-45-67891",
      periods: [{ periodStart: "2025-01-01", periodEnd: "2025-06-30", salesAmount: "12345" }],
    });
    expect(host?.textContent).toContain("확정했습니다");
  });

  it("OCR 실패·재시도에서도 첨부 파일 객체를 그대로 보존한다", async () => {
    mocks.run.mockRejectedValueOnce(new Error("synthetic ocr failure"));
    mocks.run.mockResolvedValueOnce({ text: vatText(), sourceKind: "ocr" });
    const { file } = await render();
    await act(async () => host?.querySelector<HTMLButtonElement>("button")?.click());
    expect(host?.textContent).toContain("첨부는 이미 보존되어 있습니다");
    const retry = [...host!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("같은 파일 다시"))!;
    await act(async () => retry.click());
    expect(mocks.run).toHaveBeenNthCalledWith(1, file);
    expect(mocks.run).toHaveBeenNthCalledWith(2, file);
  });
});

describe("vatBizNumberMatch", () => {
  it("10자리 정본 번호만 형식 차이를 무시해 비교한다", () => {
    expect(vatBizNumberMatch("1234567891", "123-45-67891")).toBe(true);
    expect(vatBizNumberMatch("", "123-45-67891")).toBe(false);
    expect(vatBizNumberMatch("1234567891", "123-45-67890")).toBe(false);
  });

  it("큰 매출액도 Number 반올림 없이 문자열 그대로 표시한다", () => {
    expect(formatVatAmount("9007199254740993")).toBe("9,007,199,254,740,993");
  });
});
