import { ReleaseSlotError, createReleaseSlots } from "./release-slots.mjs";

export const artifactContractUrl = new URL("../artifact/provenance.mjs", import.meta.url);

export async function createProductionReleaseSlots(options) {
  if (!options || typeof options !== "object") {
    throw new ReleaseSlotError("invalid_input", "production release options are required");
  }
  if (Object.hasOwn(options, "verifyReleaseArtifact")) {
    throw new ReleaseSlotError("invalid_input", "the production artifact verifier cannot be overridden");
  }
  const trustedBuilderPublicKeyPath = options.trustedBuilderPublicKeyPath;
  if (typeof trustedBuilderPublicKeyPath !== "string" || !trustedBuilderPublicKeyPath) {
    throw new ReleaseSlotError("invalid_input", "the pinned trusted builder public key path is required");
  }

  const contract = await import(artifactContractUrl.href);
  if (typeof contract.verifyTrustedReleaseArtifact !== "function") {
    throw new ReleaseSlotError("artifact_contract_invalid", "artifact contract does not export trusted provenance verification");
  }
  const { trustedBuilderPublicKeyPath: _trustedBuilderPublicKeyPath, ...releaseOptions } = options;
  return createReleaseSlots({
    ...releaseOptions,
    verifyReleaseArtifact: (input) => contract.verifyTrustedReleaseArtifact({
      ...input,
      trustedPublicKeyPath: trustedBuilderPublicKeyPath,
    }),
  });
}
