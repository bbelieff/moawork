export type ReleaseRing = "canary" | "stable";
export type ReleaseRouteAuthorization =
  | "active_membership"
  | "reviewed_internal_demo";
export type InternalReleaseSource = "platform_reviewed_demo";

export type ReleaseSelector =
  | {
      kind: "ready";
      orgId: string;
      routePath: `/w/${string}`;
      routeAuthorization: ReleaseRouteAuthorization;
      releaseRing: ReleaseRing;
      isInternal: boolean;
      internalSource: InternalReleaseSource | null;
      featureReleases: Readonly<Record<string, boolean>>;
    }
  | { kind: "unavailable" };

export type InternalDemoOption = Readonly<{
  orgId: string;
  routePath: `/w/${string}`;
}>;

export type InternalDemoOptionsResult =
  | { kind: "ready"; options: readonly InternalDemoOption[] }
  | { kind: "unavailable" };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTE_PATTERN = /^\/w\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FEATURE_PATTERN = /^[a-z][a-z0-9_.-]{0,79}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function featureMap(value: unknown): Readonly<Record<string, boolean>> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, boolean> = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (!FEATURE_PATTERN.test(key) || typeof enabled !== "boolean") return null;
    result[key] = enabled;
  }
  return Object.freeze(result);
}

/**
 * Parses only the server-verified selector RPC row. It never constructs a
 * workspace route from a display name or caller-provided slug.
 */
export function resolveReleaseSelector(value: unknown): ReleaseSelector {
  if (!isRecord(value)) return { kind: "unavailable" };

  const orgId = value.org_id;
  const routePath = value.route_path;
  const routeAuthorization = value.route_authorization;
  const releaseRing = value.release_ring;
  const isInternal = value.is_internal;
  const internalSource = value.internal_source;
  const releases = featureMap(value.feature_releases);

  if (
    typeof orgId !== "string" ||
    !UUID_PATTERN.test(orgId) ||
    typeof routePath !== "string" ||
    !ROUTE_PATTERN.test(routePath) ||
    (routeAuthorization !== "active_membership" &&
      routeAuthorization !== "reviewed_internal_demo") ||
    (releaseRing !== "canary" && releaseRing !== "stable") ||
    typeof isInternal !== "boolean" ||
    releases === null
  ) {
    return { kind: "unavailable" };
  }

  if (
    (isInternal && internalSource !== "platform_reviewed_demo") ||
    (!isInternal && internalSource !== null) ||
    (routeAuthorization === "reviewed_internal_demo" &&
      (!isInternal || releaseRing !== "canary"))
  ) {
    return { kind: "unavailable" };
  }

  return {
    kind: "ready",
    orgId,
    routePath: routePath as `/w/${string}`,
    routeAuthorization,
    releaseRing,
    isInternal,
    internalSource: isInternal ? "platform_reviewed_demo" : null,
    featureReleases: releases,
  };
}

/** Missing and explicit-false features are both OFF. */
export function isFeatureReleased(
  selector: ReleaseSelector,
  featureKey: string,
): boolean {
  if (selector.kind !== "ready" || !FEATURE_PATTERN.test(featureKey)) return false;
  return selector.featureReleases[featureKey] === true;
}

/**
 * Parses the platform-only discovery RPC as one atomic result. Any malformed,
 * duplicate, or over-broad row makes the whole list unavailable.
 */
export function resolveInternalDemoOptions(
  value: unknown,
): InternalDemoOptionsResult {
  if (!Array.isArray(value)) return { kind: "unavailable" };

  const options: InternalDemoOption[] = [];
  const orgIds = new Set<string>();
  const routePaths = new Set<string>();

  for (const row of value) {
    if (!isRecord(row)) return { kind: "unavailable" };
    const keys = Object.keys(row).sort();
    if (keys.length !== 2 || keys[0] !== "org_id" || keys[1] !== "route_path") {
      return { kind: "unavailable" };
    }

    const orgId = row.org_id;
    const routePath = row.route_path;
    if (
      typeof orgId !== "string" ||
      !UUID_PATTERN.test(orgId) ||
      typeof routePath !== "string" ||
      !ROUTE_PATTERN.test(routePath) ||
      orgIds.has(orgId) ||
      routePaths.has(routePath)
    ) {
      return { kind: "unavailable" };
    }

    orgIds.add(orgId);
    routePaths.add(routePath);
    options.push(Object.freeze({
      orgId,
      routePath: routePath as `/w/${string}`,
    }));
  }

  options.sort((left, right) => left.orgId.localeCompare(right.orgId));
  return { kind: "ready", options: Object.freeze(options) };
}
