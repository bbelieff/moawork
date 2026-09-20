function copy(value) {
  return structuredClone(value);
}

function healthFor(artifact, ok = true) {
  return { ok, releaseId: artifact.releaseId, sourceSha: artifact.sourceSha, serverActionsKeyFingerprint: artifact.serverActionsKeyFingerprint };
}

export function createFakeReleaseRuntime({ slotIds, active, failures = {}, stalls = {} }) {
  const events = [];
  const slots = Object.fromEntries(slotIds.map((slot) => [slot, { state: "empty", artifact: null }]));
  let generation = 0;
  let activeSlot = active?.slot ?? null;
  let previousSlot = null;
  let recovery = null;
  if (active) slots[active.slot] = { state: "active", artifact: copy(active.artifact) };

  const maybeStall = (name, signal) => {
    if (!stalls[name]) return Promise.resolve();
    return new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };
  const record = (name, fields = {}) => events.push({ name, ...fields });

  const runtime = {
    events,
    touchedServices: new Set(),
    async status({ signal }) {
      await maybeStall("status", signal);
      record("status");
      return copy({ generation, activeSlot, previousSlot, recovery, slots });
    },
    async prepare({ slot, artifact, signal }) {
      await maybeStall("prepare", signal);
      record("prepare", { slot, releaseId: artifact.releaseId });
      runtime.touchedServices.add("web");
      if (failures.prepare) throw new Error("prepare failed");
      if (slot === activeSlot) throw new Error("active slot cannot be prepared");
      slots[slot] = { state: "prepared", artifact: copy(artifact) };
      return copy({ slot, artifact });
    },
    async verifyPrepared({ slot, artifact, signal }) {
      await maybeStall("verifyPrepared", signal);
      record("verifyPrepared", { slot });
      if (failures.verifyPrepared) return { slot, artifact: { ...artifact, sourceTree: "f".repeat(40) } };
      return copy({ slot, artifact: slots[slot].artifact });
    },
    async startCandidate({ slot, artifact, signal }) {
      await maybeStall("startCandidate", signal);
      record("startCandidate", { slot });
      if (failures.startCandidate) throw new Error("start failed");
      slots[slot] = { state: "running", artifact: copy(artifact) };
    },
    async checkCandidate({ slot, artifact, signal }) {
      await maybeStall("checkCandidate", signal);
      record("checkCandidate", { slot });
      return healthFor(artifact, !failures.candidateHealth);
    },
    async rejectCandidate({ slot, signal }) {
      await maybeStall("rejectCandidate", signal);
      record("rejectCandidate", { slot });
      slots[slot].state = "failed";
    },
    async switchActive({ expectedActiveSlot, expectedGeneration, targetSlot, artifact, signal }) {
      await maybeStall("switchActive", signal);
      record("switchActive", { expectedActiveSlot, targetSlot });
      if (failures.switchActive) throw new Error("switch failed");
      if (activeSlot !== expectedActiveSlot || generation !== expectedGeneration) throw new Error("concurrent switch");
      if (slots[targetSlot].artifact?.releaseId !== artifact.releaseId) throw new Error("target release mismatch");
      const oldActive = activeSlot;
      if (oldActive !== null) slots[oldActive].state = "running";
      slots[targetSlot].state = "active";
      activeSlot = targetSlot;
      previousSlot = oldActive;
      generation += 1;
      return copy({ generation, activeSlot, previousSlot });
    },
    async checkPublic({ artifact, signal }) {
      await maybeStall("checkPublic", signal);
      record("checkPublic", { releaseId: artifact.releaseId });
      const fail = failures.publicHealth === true
        || (Array.isArray(failures.publicHealth) && failures.publicHealth.shift() === true);
      const result = healthFor(artifact, !fail);
      if (failures.publicServerActionsKey) result.serverActionsKeyFingerprint = "8".repeat(64);
      return result;
    },
  };
  return runtime;
}
