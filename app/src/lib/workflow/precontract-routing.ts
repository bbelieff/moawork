export const PRECONTRACT_MENU_IDS = ["new-lead", "consultation"] as const;
export type PrecontractMenuId = (typeof PRECONTRACT_MENU_IDS)[number];

export const CONSULTATION_VIEW_IDS = ["all", "remote", "inperson", "unspecified"] as const;
export type ConsultationViewId = (typeof CONSULTATION_VIEW_IDS)[number];

export const CONSULTATION_CANONICAL_PATH = "/contract" as const;
export const CONSULTATION_LEGACY_PATHS = {
  remote: "/consult-remote",
  inperson: "/consult-inperson",
} as const;

export type ConsultationRouteResolution = Readonly<{
  menuId: "consultation";
  viewId: ConsultationViewId;
  canonicalHref: string;
  legacyAlias: boolean;
}>;

const SAFE_CONSULTATION_QUERY_KEYS = new Set([
  "as",
  "savedView",
  "view",
  "group",
  "mwLayout",
  "mwHidden",
  "mwOrder",
  "mwFilters",
  "mwSort",
  "mwText",
  "mwFocus",
  "sort",
  "calendarField",
]);

function safeInternalUrl(value: unknown): URL | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  try {
    const url = new URL(value, "https://moawork.invalid");
    return url.origin === "https://moawork.invalid" ? url : null;
  } catch {
    return null;
  }
}

function viewFromCanonicalQuery(value: string | null): ConsultationViewId {
  if (value === null || value === "") return "all";
  if (value === "remote" || value === "inperson") return value;
  return "unspecified";
}

/**
 * Resolve the canonical consultation menu without treating a route, query, or
 * saved view as authority. Legacy entry URLs remain bookmarks for the same
 * contact data; only their presentation view changes.
 */
export function resolveConsultationRoute(value: unknown): ConsultationRouteResolution | null {
  const input = safeInternalUrl(value);
  if (!input) return null;

  const legacyView = input.pathname === CONSULTATION_LEGACY_PATHS.remote
    ? "remote"
    : input.pathname === CONSULTATION_LEGACY_PATHS.inperson
      ? "inperson"
      : null;
  if (input.pathname !== CONSULTATION_CANONICAL_PATH && legacyView === null) return null;

  const viewId = legacyView ?? viewFromCanonicalQuery(input.searchParams.get("consultation"));
  const output = new URL(CONSULTATION_CANONICAL_PATH, input.origin);
  for (const [key, queryValue] of input.searchParams) {
    if (SAFE_CONSULTATION_QUERY_KEYS.has(key)) output.searchParams.append(key, queryValue);
  }
  if (viewId === "remote" || viewId === "inperson") {
    output.searchParams.set("consultation", viewId);
  }

  return {
    menuId: "consultation",
    viewId,
    canonicalHref: `${output.pathname}${output.search}${input.hash}`,
    legacyAlias: legacyView !== null,
  };
}
