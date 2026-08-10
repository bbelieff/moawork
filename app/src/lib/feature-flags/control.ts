import type {
  FeatureFlagDefinition,
  FeatureFlagPlan,
  FeatureFlagStage,
  FeatureFlagState,
} from "./types";

const FEATURE_KEY = /^[a-z][a-z0-9_.-]{0,79}$/;
const OWNER_KEY = /^[a-z][a-z0-9_.-]{0,79}$/;

export function validateFeatureFlagDefinition(
  value: FeatureFlagDefinition,
  now = new Date(),
): readonly string[] {
  const errors: string[] = [];
  if (!FEATURE_KEY.test(value.key)) errors.push("feature_key_invalid");
  if (!OWNER_KEY.test(value.owner)) errors.push("owner_invalid");

  const removal = new Date(value.removalDueAt);
  if (Number.isNaN(removal.valueOf())) errors.push("removal_due_at_invalid");
  else if (removal <= now) errors.push("removal_due_at_expired");
  return errors;
}

export function resolveFeatureFlagStage(state: FeatureFlagState): FeatureFlagStage | null {
  if (state.stable && !state.canary) return null;
  if (state.stable) return "stable";
  if (state.canary) return "canary";
  return "off";
}

/**
 * Produces the only supported rollout transitions. Rollback always disables
 * stable before canary so an interrupted client remains fail-closed.
 */
export function planFeatureFlagTransition(
  state: FeatureFlagState,
  target: FeatureFlagStage,
): FeatureFlagPlan | null {
  const current = resolveFeatureFlagStage(state);
  if (current === null) return null;

  if (target === "off") {
    return {
      from: current,
      to: "off",
      mutations: Object.freeze([
        { ring: "stable", enabled: false },
        { ring: "canary", enabled: false },
      ]),
    };
  }
  if (current === target) return { from: current, to: target, mutations: [] };
  if (current === "off" && target === "canary") {
    return { from: current, to: target, mutations: [{ ring: "canary", enabled: true }] };
  }
  if (current === "canary" && target === "stable") {
    return { from: current, to: target, mutations: [{ ring: "stable", enabled: true }] };
  }
  return null;
}
