import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContractStatusField } from "../../components/deal/ContractStatusField";

const coreFlowFiles = [
  new URL("./page.tsx", import.meta.url),
  new URL("./dash/[pipelineId]/page.tsx", import.meta.url),
  new URL("./deals/[dealId]/page.tsx", import.meta.url),
  new URL("../../components/dash/widgets.tsx", import.meta.url),
  new URL("../../components/deal/DealInfoTab.tsx", import.meta.url),
  new URL("../../components/deal/DealActivityTab.tsx", import.meta.url),
  new URL("../../components/deal/ContractStatusField.tsx", import.meta.url),
];

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("BBE-96 core CRM UX writing", () => {
  it("keeps internal deal terminology out of rendered core copy", () => {
    for (const file of coreFlowFiles) {
      const source = withoutComments(readFileSync(fileURLToPath(file), "utf8"));
      expect(source, file.pathname).not.toContain("딜");
    }
  });

  it("explains 업무 on both the home and dashboard pages", () => {
    const home = readFileSync(fileURLToPath(coreFlowFiles[0]), "utf8");
    const dashboard = readFileSync(fileURLToPath(coreFlowFiles[1]), "utf8");
    const explanation = "업무는 업체와 진행하는 각각의 일입니다.";

    expect(home).toContain(explanation);
    expect(dashboard).toContain(explanation);
  });

  it("states the real conditions for representative empty and unavailable views", () => {
    const contractStatus = renderToStaticMarkup(
      createElement(ContractStatusField, {
        fieldDef: undefined,
        value: null,
        onChange: () => undefined,
      }),
    );
    const home = readFileSync(fileURLToPath(coreFlowFiles[0]), "utf8");
    const dashboard = readFileSync(fileURLToPath(coreFlowFiles[1]), "utf8");

    expect(contractStatus).toContain(
      "계약상황 항목이 준비되면 여기에서 선택할 수 있어요.",
    );
    expect(dashboard).toContain("이 단계에 업무가 등록되면 여기에 보여요.");
    expect(home).toContain(
      'emptyHint="이번 달 수납 내역이 아직 없어요. 수수료입금일이 이번 달인 업무가 생기면 여기에 보여요."',
    );
    expect(home).toContain("업무 담당자로 지정되면 여기에 보여요.");
  });
});
