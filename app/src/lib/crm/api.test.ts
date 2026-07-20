/**
 * API 라우트 스모크 테스트 (T02) — 라우트 핸들러를 인메모리 스토어로 직접 호출.
 * HTTP 매핑(상태코드/헤더/에러)까지 검증.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { setStore, InMemoryCrmStore } from "@/lib/crm";
import { GET as listBoards, POST as createBoard } from "@/app/api/boards/route";
import { POST as createItem } from "@/app/api/boards/[boardId]/items/route";
import { POST as moveItem } from "@/app/api/items/[itemId]/move/route";
import { GET as getItem } from "@/app/api/items/[itemId]/route";

const ORG = { "x-org-id": "org1", "x-user-id": "u1", "content-type": "application/json" };

function req(url: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  return new Request(url, init);
}

async function body(res: Response) {
  return (await res.json()) as { data?: unknown; error?: string };
}

beforeEach(() => setStore(new InMemoryCrmStore()));

describe("POST/GET /api/boards", () => {
  it("보드 생성 → 201 + 목록 조회", async () => {
    const created = await createBoard(
      req("http://x/api/boards", { method: "POST", headers: ORG, body: JSON.stringify({ name: "신규고객" }) }),
    );
    expect(created.status).toBe(201);
    const { data } = await body(created);
    expect((data as { board: { name: string } }).board.name).toBe("신규고객");

    const list = await listBoards(req("http://x/api/boards", { headers: ORG }));
    expect(list.status).toBe(200);
    const listed = (await body(list)).data as unknown[];
    expect(listed).toHaveLength(1);
  });

  it("org 헤더 없으면 401", async () => {
    const res = await createBoard(
      req("http://x/api/boards", { method: "POST", body: JSON.stringify({ name: "x" }) }),
    );
    expect(res.status).toBe(401);
  });

  it("name 누락 시 400", async () => {
    const res = await createBoard(
      req("http://x/api/boards", { method: "POST", headers: ORG, body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(400);
  });
});

describe("아이템 생성 · 수식 · 단계 이동 (HTTP)", () => {
  it("생성 시 수식 계산, 이동 시 자동화 반영", async () => {
    // 보드 생성
    const bres = await createBoard(
      req("http://x/api/boards", { method: "POST", headers: ORG, body: JSON.stringify({ name: "b" }) }),
    );
    const boardId = (await body(bres)).data as { board: { id: string } };
    const bid = boardId.board.id;

    // 아이템 생성 (계약금액/수수료율)
    const ires = await createItem(
      req(`http://x/api/boards/${bid}/items`, {
        method: "POST",
        headers: ORG,
        body: JSON.stringify({ name: "홍길동", values: { contract_amount: 100_000_000, commission_rate: 3 } }),
      }),
      { params: Promise.resolve({ boardId: bid }) },
    );
    expect(ires.status).toBe(201);
    const item = (await body(ires)).data as { id: string; formulas: Record<string, unknown> };
    expect(item.formulas.commission).toBe(3_000_000);
    expect(item.formulas.total_revenue).toBe(3_300_000);

    // 진행중 이동 → 계약일 자동 세팅 → D+180 생성
    const mres = await moveItem(
      req(`http://x/api/items/${item.id}/move`, {
        method: "POST",
        headers: ORG,
        body: JSON.stringify({ stageKey: "in_progress" }),
      }),
      { params: Promise.resolve({ itemId: item.id }) },
    );
    expect(mres.status).toBe(200);
    const moved = (await body(mres)).data as { values: Record<string, unknown>; formulas: Record<string, unknown> };
    expect(moved.values.contract_date).toBeTruthy();
    expect(moved.formulas.d_plus_180).toBeTruthy();

    // 상세 조회
    const gres = await getItem(
      req(`http://x/api/items/${item.id}`, { headers: ORG }),
      { params: Promise.resolve({ itemId: item.id }) },
    );
    expect(gres.status).toBe(200);
  });

  it("알 수 없는 아이템 이동 → 404", async () => {
    const res = await moveItem(
      req("http://x/api/items/ghost/move", {
        method: "POST",
        headers: ORG,
        body: JSON.stringify({ stageKey: "done" }),
      }),
      { params: Promise.resolve({ itemId: "ghost" }) },
    );
    expect(res.status).toBe(404);
  });
});
