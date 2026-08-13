import { BoardsService } from "@/lib/boards";
import { getCrmService } from "@/lib/crm";
import { getNoticesService } from "@/lib/notices";
import type { Ctx } from "@/lib/types";
import type { RecentRef, SearchResponse, SearchResult } from "./types";

export type SearchCollections = {
  boards: Array<{ id: string; name: string; description?: string | null }>;
  deals: Array<{ id: string; title: string; status_note?: string | null }>;
  companies: Array<{ id: string; name: string; biz_type?: string | null; region?: string | null }>;
  notices: Array<{ id: string; title: string; body?: string | null; categoryLabel?: string | null }>;
};

type IndexedResult = SearchResult & { haystack: string };

const MAX_QUERY_LENGTH = 80;
const MAX_RESULTS = 24;
const MAX_RECENT = 8;

export function normalizeQuery(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_QUERY_LENGTH);
}

function searchable(...values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(" ").toLocaleLowerCase("ko-KR");
}

function withoutIndex({ haystack, ...result }: IndexedResult): SearchResult {
  void haystack;
  return result;
}

export function buildSearchResponse(
  collections: SearchCollections,
  rawQuery: string | null | undefined,
  recentRefs: RecentRef[] = [],
): SearchResponse {
  const query = normalizeQuery(rawQuery);
  const all: IndexedResult[] = [
    ...collections.boards.map((board) => ({
      kind: "board" as const,
      id: board.id,
      title: board.name,
      description: board.description ?? "보드",
      href: `/boards/${encodeURIComponent(board.id)}`,
      haystack: searchable(board.name, board.description),
    })),
    ...collections.deals.map((deal) => ({
      kind: "deal" as const,
      id: deal.id,
      title: deal.title,
      description: deal.status_note ?? "업무",
      href: `/deals/${encodeURIComponent(deal.id)}`,
      haystack: searchable(deal.title, deal.status_note),
    })),
    ...collections.companies.map((company) => ({
      kind: "company" as const,
      id: company.id,
      title: company.name,
      description: [company.biz_type, company.region].filter(Boolean).join(" · ") || "회사",
      href: `/companies/${encodeURIComponent(company.id)}`,
      haystack: searchable(company.name, company.biz_type, company.region),
    })),
    ...collections.notices.map((notice) => ({
      kind: "notice" as const,
      id: notice.id,
      title: notice.title,
      description: notice.categoryLabel ?? "공지",
      href: "/notices",
      haystack: searchable(notice.title, notice.body, notice.categoryLabel),
    })),
  ];

  const terms = query.toLocaleLowerCase("ko-KR").split(" ").filter(Boolean);
  const results = query === ""
    ? []
    : all
        .filter((item) => terms.every((term) => item.haystack.includes(term)))
        .slice(0, MAX_RESULTS)
        .map(withoutIndex);

  const visibleByRef = new Map(all.map((item) => [`${item.kind}:${item.id}`, item]));
  const recent = recentRefs
    .map((ref) => visibleByRef.get(`${ref.kind}:${ref.id}`))
    .filter((item): item is (typeof all)[number] => Boolean(item))
    .slice(0, MAX_RECENT)
    .map(withoutIndex);

  return { query, results, recent };
}

export async function searchWorkspace(
  ctx: Ctx,
  query: string | null | undefined,
  recentRefs: RecentRef[],
): Promise<SearchResponse> {
  const crm = getCrmService();
  const [deals, companies] = await Promise.all([
    crm.listDeals(ctx),
    crm.listCompanies(ctx),
  ]);
  const [boards, notices] = await Promise.all([
    new BoardsService().listBoards(ctx),
    getNoticesService().list(ctx),
  ]);
  return buildSearchResponse({ boards, deals, companies, notices }, query, recentRefs);
}

export async function quickCreate(
  ctx: Ctx,
  input: { kind: "deal" | "company"; title: string },
): Promise<SearchResult> {
  const title = normalizeQuery(input.title);
  if (!title) throw new Error("이름을 입력해 주세요");
  const crm = getCrmService();
  if (input.kind === "company") {
    const company = await crm.createCompany(ctx, { name: title });
    return { kind: "company", id: company.id, title: company.name, description: "새 회사", href: `/companies/${encodeURIComponent(company.id)}` };
  }
  const deal = await crm.createDeal(ctx, { title });
  return { kind: "deal", id: deal.id, title: deal.title, description: "새 업무", href: `/deals/${encodeURIComponent(deal.id)}` };
}
