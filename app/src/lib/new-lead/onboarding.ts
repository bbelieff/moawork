export const NEW_LEAD_ONBOARDING_VERSION = "new-lead-v6plus-1";

export type NewLeadOnboardingState = "completed" | "dismissed" | null;

export function parseNewLeadOnboardingState(value: unknown): NewLeadOnboardingState {
  return value === "completed" || value === "dismissed" ? value : null;
}

export async function loadNewLeadOnboardingState(
  client: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> } | null,
  orgId: string,
): Promise<{ available: boolean; state: NewLeadOnboardingState }> {
  if (!client) return { available: false, state: null };
  const result = await client.rpc("get_new_lead_onboarding_state", {
    p_org_id: orgId,
    p_version: NEW_LEAD_ONBOARDING_VERSION,
  });
  if (result.error) return { available: false, state: null };
  if (!Array.isArray(result.data)) return { available: false, state: null };
  if (result.data.length === 0) return { available: true, state: null };
  if (result.data.length !== 1) return { available: false, state: null };
  const row = result.data[0];
  const state = parseNewLeadOnboardingState(
    row && typeof row === "object" ? (row as { state?: unknown }).state : null,
  );
  return state ? { available: true, state } : { available: false, state: null };
}
