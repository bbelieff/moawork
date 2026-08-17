import assert from "node:assert/strict";
import test from "node:test";
import { validateIdentity, validatePostflight } from "./hosted-migration-runbook.mjs";

const metadata = { logicalKey: "094_guard", fileName: "094_guard.sql", digest: "a".repeat(64), predecessor: "093_base" };

test("requires exact executor, thread and commit identities", () => {
  assert.doesNotThrow(() => validateIdentity({ executor: "DG-06", thread: "019fe78c-cb3f-79f1-92e5-ea72b7d222e0", head: "b".repeat(40) }));
  assert.throws(() => validateIdentity({ executor: "someone", thread: "x", head: "short" }), /executor/u);
});

test("postflight requires exact ledger/history identity and customer DML zero", () => {
  const good = { logicalKey: "094_guard", fileName: "094_guard.sql", fileDigest: "a".repeat(64), expectedPredecessor: "093_base", guardCount: 1, historyCount: 1, historyVersions: ["20260817130000"], historyPayloadDigests: ["a".repeat(64)], customerDmlCount: 0 };
  assert.equal(validatePostflight(metadata, good).guardCount, 1);
  assert.throws(() => validatePostflight(metadata, { ...good, historyCount: 2 }), /guard1\/history1/u);
  assert.throws(() => validatePostflight(metadata, { ...good, customerDmlCount: 1 }), /customer DML/u);
});

test("rejects the observed 092 duplicate history recurrence even when payloads are identical", () => {
  const duplicate092 = {
    logicalKey: "094_guard",
    fileName: "094_guard.sql",
    fileDigest: "a".repeat(64),
    expectedPredecessor: "093_base",
    guardCount: 1,
    historyCount: 2,
    historyVersions: ["123531", "123550"],
    historyPayloadDigests: ["a".repeat(64), "a".repeat(64)],
    customerDmlCount: 0,
  };
  assert.throws(() => validatePostflight(metadata, duplicate092), /guard1\/history1/u);
});
