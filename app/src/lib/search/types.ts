export const SEARCH_KINDS = ["board", "deal", "company", "notice"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export type SearchResult = {
  kind: SearchKind;
  id: string;
  title: string;
  description: string;
  href: string;
};

export type RecentRef = Pick<SearchResult, "kind" | "id">;

export type SearchResponse = {
  query: string;
  results: SearchResult[];
  recent: SearchResult[];
};
