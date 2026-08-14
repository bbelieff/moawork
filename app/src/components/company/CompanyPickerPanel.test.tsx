import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CompanyPickerPanel } from "./CompanyPickerPanel";
import type { CompanyCandidate } from "@/lib/company/types";

const WOOJIN: CompanyCandidate = {
  id: "c1",
  bizNo: "123-45-67890",
  name: "우진산업㈜",
  ceoName: "정우진",
  bizType: "법인",
  industry: "제조업",
  regionSido: "경남",
  regionSigungu: "김해시",
  phone: "010-3390-••••",
  foundedOn: "2009",
  revenue: "54억",
  dealCount: 3,
  lastActivity: "혁신성장자금 · 진행중",
};

const SERIM: CompanyCandidate = {
  id: "c2",
  bizNo: null,
  name: "세림기업",
  ceoName: "최세림",
  bizType: "개인",
  industry: "제조업",
  regionSido: "부산",
  regionSigungu: "사상구",
  phone: null,
  foundedOn: "2020",
  revenue: "4억",
  dealCount: 0,
  lastActivity: null,
};

const COMPANIES = [WOOJIN, SERIM];

const noop = () => {};

describe("CompanyPickerPanel (BBE-125)", () => {
  it("빈 검색어면 전체 업체와 진행 이력을 보여준다", () => {
    const html = renderToStaticMarkup(
      <CompanyPickerPanel companies={COMPANIES} query="" onQueryChange={noop} onPick={noop} onCreateNew={noop} />,
    );
    expect(html).toContain("우진산업㈜");
    expect(html).toContain("진행 이력 3건");
    expect(html).toContain("세림기업");
    expect(html).toContain("이력 없음");
    expect(html).toContain("새 업체로 등록");
  });

  it("초성 검색어로 좁혀진 결과만 보여준다 — 수용 기준 ㅇㅈㅅㅇ", () => {
    const html = renderToStaticMarkup(
      <CompanyPickerPanel companies={COMPANIES} query="ㅇㅈㅅㅇ" onQueryChange={noop} onPick={noop} onCreateNew={noop} />,
    );
    expect(html).toContain("우진산업㈜");
    expect(html).not.toContain("세림기업");
  });

  it("검색어가 이름을 만들지 못하면 빈 상태 + «이름» 새 업체로 등록을 보여준다", () => {
    const html = renderToStaticMarkup(
      <CompanyPickerPanel companies={COMPANIES} query="없는회사" onQueryChange={noop} onPick={noop} onCreateNew={noop} />,
    );
    expect(html).toContain("«없는회사» 로 찾은 업체가 없습니다");
    expect(html).toContain("«없는회사» 새 업체로 등록");
  });

  it("대표자·업종 등 요약 정보를 함께 보여준다(선택 시 자동 채움 대상)", () => {
    const html = renderToStaticMarkup(
      <CompanyPickerPanel companies={COMPANIES} query="" onQueryChange={noop} onPick={noop} onCreateNew={noop} />,
    );
    expect(html).toContain("정우진 · 법인 · 제조업 · 경남 김해시");
  });

  it("검색창 입력이 onQueryChange로 전달된다(제어 컴포넌트)", () => {
    const onQueryChange = vi.fn();
    const html = renderToStaticMarkup(
      <CompanyPickerPanel companies={COMPANIES} query="검색어" onQueryChange={onQueryChange} onPick={noop} onCreateNew={noop} />,
    );
    expect(html).toContain('value="검색어"');
  });
});
