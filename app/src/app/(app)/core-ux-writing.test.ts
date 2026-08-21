import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContractStatusField } from "../../components/deal/ContractStatusField";

// BBE-186: 홈에 있던 분석 위젯이 /dash 로 옮겨 갔다. 그 위젯들이 지고 있던 문구 보증도
// 같이 옮긴다 — 홈에서 지우고 끝내면 «옮김» 이 아니라 «유실» 이 된다(수용기준 3).
const homePage = new URL("./page.tsx", import.meta.url);
// ★ BBE-215 — 「업무 분석」이 홈 아래 「회사 현황」 절이 됐다. 단언은 그대로고 «대상 파일» 만 따라간다.
//   (app)/dash/page.tsx 는 이제 redirect 뿐이라 문구가 없다. 문구는 절과 함께 옮겨갔다.
const analysisPage = new URL("../../components/dash/CompanyStatusSection.tsx", import.meta.url);
const monthlyCollection = new URL("../../components/dash/MonthlyCollection.tsx", import.meta.url);
const pipelinePage = new URL("./dash/[pipelineId]/page.tsx", import.meta.url);
const todayHome = new URL("../../components/dash/TodayHome.tsx", import.meta.url);

const coreFlowFiles = [
  homePage,
  analysisPage,
  monthlyCollection,
  pipelinePage,
  todayHome,
  new URL("./deals/[dealId]/page.tsx", import.meta.url),
  new URL("../../components/dash/widgets.tsx", import.meta.url),
  new URL("../../components/deal/DealInfoTab.tsx", import.meta.url),
  new URL("../../components/deal/ContractStatusField.tsx", import.meta.url),
];

function read(file: URL): string {
  return readFileSync(fileURLToPath(file), "utf8");
}

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("BBE-96 core CRM UX writing", () => {
  it("keeps internal deal terminology out of rendered core copy", () => {
    for (const file of coreFlowFiles) {
      const source = withoutComments(read(file));
      expect(source, file.pathname).not.toContain("딜");
    }
  });

  it("explains 업무 on both analysis pages", () => {
    const explanation = "업무는 업체와 진행하는 각각의 일입니다.";
    expect(read(analysisPage)).toContain(explanation);
    expect(read(pipelinePage)).toContain(explanation);
  });

  it("states the real conditions for representative empty and unavailable views", () => {
    const contractStatus = renderToStaticMarkup(
      createElement(ContractStatusField, {
        fieldDef: undefined,
        value: null,
        onChange: () => undefined,
      }),
    );

    expect(contractStatus).toContain(
      "계약상황 항목이 준비되면 여기에서 선택할 수 있어요.",
    );
    expect(read(pipelinePage)).toContain("이 단계에 업무가 등록되면 여기에 보여요.");
    // ★ BBE-215 — 「이번달 수납」이 RPC 정본으로 바뀌면서 이 자리는 «한 문장» 이 아니라
    //   «세 상태» 가 됐다. 걱정(빈 화면에 실제 조건을 말하라)은 그대로고, 문구가 늘었다.
    //   0 을 그냥 0 으로 두면 「수납이 없다」와 「입금일을 안 채웠다」가 같은 화면이 된다.
    const section = read(monthlyCollection);
    expect(section, "탭이 없는 경우를 안 말한다").toContain("계약업체 실무 탭이 아직 없어요");
    expect(section, "미입력을 안 말한다").toContain("입금일이 아직 입력되지 않았어요");
    expect(section, "진짜 0 을 안 말한다").toContain("이번 달 수납이 아직 없어요");
    expect(read(analysisPage)).toContain("업무 담당자로 지정되면 여기에 보여요.");
  });

  it("홈은 오늘 화면의 빈 상태를 자기 말로 설명한다", () => {
    // 위 문구들이 /dash 로 옮겨 갔으므로, 홈에는 홈 나름의 빈 상태 문구가 있어야 한다.
    const today = read(todayHome);
    expect(today).toContain("오늘 처리할 업무가 없습니다.");
    expect(today).toContain("아직 없습니다.");
  });
});
