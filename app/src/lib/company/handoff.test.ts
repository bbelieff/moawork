import { describe, expect, it } from "vitest";
import { handoffCompany, type CompanyHandoffStore } from "./handoff";
import type { CompanyCandidate, CompanyHandoffInput } from "./types";

function company(id: string, overrides: Partial<CompanyCandidate> = {}): CompanyCandidate {
  return {
    id,
    bizNo: null,
    name: "새봄상사",
    ceoName: "오새봄",
    bizType: "법인",
    industry: "도소매",
    regionSido: "서울",
    regionSigungu: "강서구",
    phone: "0212345678",
    foundedOn: "2020",
    revenue: "100000000",
    dealCount: 0,
    lastActivity: null,
    ...overrides,
  };
}

class MemoryStore implements CompanyHandoffStore {
  readonly attached: Array<[string, string]> = [];
  readonly created: Array<{ input: CompanyHandoffInput; candidates: readonly string[] }> = [];

  constructor(readonly companies: CompanyCandidate[]) {}

  async listCompanies() {
    return this.companies;
  }

  async createCompany(input: CompanyHandoffInput, duplicateCandidateIds: readonly string[]) {
    this.created.push({ input, candidates: duplicateCandidateIds });
    const created = company(`company-${this.companies.length + 1}`, {
      name: input.name,
      bizNo: input.bizNo ?? null,
      ceoName: input.ceoName ?? null,
    });
    this.companies.push(created);
    return created;
  }

  async attachDeal(dealId: string, companyId: string) {
    this.attached.push([dealId, companyId]);
  }
}

const input: CompanyHandoffInput = {
  dealId: "deal-1",
  name: "새봄상사",
  bizNo: "123-45-67890",
  ceoName: "오새봄",
};

describe("handoffCompany (BBE-125)", () => {
  it("사업자등록번호가 같은 회사는 새로 만들지 않고 딜만 연결한다", async () => {
    const existing = company("company-existing", { bizNo: "1234567890" });
    const store = new MemoryStore([existing]);

    const result = await handoffCompany(store, input);

    expect(result.mode).toBe("existing");
    expect(store.created).toHaveLength(0);
    expect(store.attached).toEqual([["deal-1", "company-existing"]]);
    expect(result.reference.companyId).toBe("company-existing");
  });

  it("일치가 없으면 회사 1건을 만들고 딜 1건을 참조로 연결한다", async () => {
    const store = new MemoryStore([]);

    const result = await handoffCompany(store, input);

    expect(result.mode).toBe("created");
    expect(store.created).toHaveLength(1);
    expect(store.attached).toEqual([["deal-1", result.company.id]]);
    expect(result.reference.fields).toHaveLength(7);
  });

  it("이름+대표자만 같은 건은 별도 생성하고 검토 후보를 보존한다", async () => {
    const suspect = company("company-suspect", { name: "주식회사 새봄상사", bizNo: null });
    const store = new MemoryStore([suspect]);

    const result = await handoffCompany(store, { ...input, bizNo: null });

    expect(result.mode).toBe("created_needs_review");
    expect(store.created[0].candidates).toEqual(["company-suspect"]);
    expect(store.attached[0][1]).not.toBe("company-suspect");
  });

  it("확정 키가 이미 둘이면 임의 선택하지 않고 중단한다", async () => {
    const store = new MemoryStore([
      company("company-a", { bizNo: "1234567890" }),
      company("company-b", { bizNo: "123-45-67890" }),
    ]);

    await expect(handoffCompany(store, input)).rejects.toThrow("둘 이상");
    expect(store.attached).toHaveLength(0);
    expect(store.created).toHaveLength(0);
  });
});
