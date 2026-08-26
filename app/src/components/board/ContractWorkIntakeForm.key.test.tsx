import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ContractWorkIntakeForm } from "./ContractWorkIntakeForm";
import type { CompanyPickerRow } from "@/lib/companies/search";

vi.mock("next/navigation", () => ({ usePathname: () => "/w/sample-lab/boards/b-1" }));

/**
 * 「＋ 업체 추가」의 멱등 열쇠가 «선택마다» 하나여야 한다.
 *
 * 이 파일이 지키는 것은 하나다 — 열쇠를 화면 그릴 때 미리 박아 두지 않는다.
 * 렌더당 하나를 발급하면 모든 행이 같은 열쇠를 달고, RPC 가 같은 열쇠를
 * «다른 회사» 로 쓰는 것을 거절한다(117 마이그레이션 :92, 22023).
 * 그러면 회사A 를 고른 직후 회사B 를 고르는 것이 «항상» 실패한다 —
 * 이 기능의 수용조건(동일 회사 반복 허용 · 동일 request 만 차단)을 정확히 뒤집는다.
 */
function row(id: string, name: string): CompanyPickerRow {
  return {
    company: {
      id,
      org_id: "org-1",
      name,
      owner_name: null,
      phone: null,
      email: null,
      biz_type: null,
      region: null,
      homepage: null,
    } as unknown as CompanyPickerRow["company"],
    dealCount: 0,
  };
}

const ROWS = [row("c-1", "가나상사"), row("c-2", "다라물산")];

function markup() {
  return renderToStaticMarkup(
    <ContractWorkIntakeForm
      rows={ROWS}
      boardId="b-1"
      startWorkAction={async () => ({ ok: true, message: "" })}
    />,
  );
}

describe("업체 추가 — 멱등 열쇠는 선택마다 하나다", () => {
  it("열쇠를 «미리 박아 두지 않는다» — 그리는 값은 비어 있다", () => {
    // 닫힌 상태에서는 폼 자체가 없다. 열린 상태를 직접 만들 수 없으므로
    // 원본을 읽어 «렌더 중 값을 넣는 형태» 가 아닌지 본다.
    const source = readFileSync(new URL("./ContractWorkIntakeForm.tsx", import.meta.url), "utf8");

    // requestId 입력칸은 defaultValue="" 로 비어 있어야 한다.
    expect(source).toMatch(/name="requestId"\s*\n?\s*defaultValue=""/);

    // 렌더 중 randomUUID 를 부르면 SSR/클라이언트 값이 갈려 hydration 이 깨진다.
    // 호출은 오직 제출 핸들러 안에서만 일어나야 한다.
    const submitHandler = source.slice(source.indexOf("function stampRequestId"));
    expect(submitHandler).toContain("crypto.randomUUID()");
    const beforeHandler = source.slice(0, source.indexOf("function stampRequestId"));
    expect(beforeHandler).not.toContain("crypto.randomUUID()");
  });

  it("서버가 발급한 열쇠를 프롭으로 받지 않는다 — 그 형태가 결함의 원인이었다", () => {
    const source = readFileSync(new URL("./ContractWorkIntakeForm.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/^\s*requestId: string;/m);
  });

  it("각 회사 행이 제출 핸들러를 달고 있다", () => {
    const source = readFileSync(new URL("./ContractWorkIntakeForm.tsx", import.meta.url), "utf8");
    expect(source).toContain("onSubmit={stampRequestId}");
  });

  it("닫힌 상태에서는 목록을 그리지 않는다 — 회사 정보를 미리 흘리지 않는다", () => {
    const html = markup();
    expect(html).toContain("업체 추가");
    expect(html).not.toContain("가나상사");
  });
});
