export type FeatureFlagRing = "canary" | "stable";

export type FeatureFlagStage = "off" | "canary" | "stable";

export type FeatureFlagDefinition = Readonly<{
  key: string;
  owner: string;
  removalDueAt: string;
}>;

export type FeatureFlagState = Readonly<{
  canary: boolean;
  stable: boolean;
}>;

export type FeatureFlagMutation = Readonly<{
  ring: FeatureFlagRing;
  enabled: boolean;
}>;

export type FeatureFlagPlan = Readonly<{
  from: FeatureFlagStage;
  to: FeatureFlagStage;
  mutations: readonly FeatureFlagMutation[];
}>;
