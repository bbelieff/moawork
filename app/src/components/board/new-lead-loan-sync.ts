import type { ExistingLoanRecord } from "@/lib/new-lead/financial-profile";

export type LoanRecordLocation = { boardId: string; itemId: string };
export type LoanRecordSnapshot = Readonly<{
  records: readonly ExistingLoanRecord[];
  digest: string;
  staleDigests: ReadonlySet<string>;
}>;
export type LoanRecordResolution = Readonly<{
  records: readonly ExistingLoanRecord[];
  disposition: "none" | "stale-props" | "confirmed" | "newer-props";
}>;

type StoreEntry = {
  snapshot: LoanRecordSnapshot | null;
  listeners: Map<string, () => void>;
  consumerDigests: Map<string, string | null>;
  cleanupQueued: boolean;
};

export const LOAN_RECORD_SYNC_LIMIT = 200;
const entries = new Map<string, StoreEntry>();

function locationKey({ boardId, itemId }: LoanRecordLocation) {
  return `${boardId}\u0000${itemId}`;
}

export function loanRecordsDigest(records: readonly ExistingLoanRecord[]) {
  return JSON.stringify(records);
}

function entryFor(location: LoanRecordLocation) {
  const key = locationKey(location);
  const current = entries.get(key) ?? {
    snapshot: null,
    listeners: new Map<string, () => void>(),
    consumerDigests: new Map<string, string | null>(),
    cleanupQueued: false,
  };
  entries.set(key, current);
  return current;
}

function notify(entry: StoreEntry) {
  for (const listener of entry.listeners.values()) listener();
}

function retainEntry(location: LoanRecordLocation, entry: StoreEntry) {
  const key = locationKey(location);
  entries.delete(key);
  entries.set(key, entry);
  if (entries.size <= LOAN_RECORD_SYNC_LIMIT) return;
  for (const [candidateKey, candidate] of entries) {
    if (candidate.listeners.size === 0) {
      entries.delete(candidateKey);
      if (entries.size <= LOAN_RECORD_SYNC_LIMIT) break;
    }
  }
}

function scheduleConfirmedCleanup(key: string, entry: StoreEntry) {
  if (entry.cleanupQueued) return;
  entry.cleanupQueued = true;
  queueMicrotask(() => {
    entry.cleanupQueued = false;
    if (entries.get(key) !== entry) return;
    const snapshot = entry.snapshot;
    if (
      snapshot
      && entry.consumerDigests.size > 0
      && [...entry.consumerDigests.values()].every((digest) => digest === snapshot.digest)
    ) {
      entry.snapshot = null;
      notify(entry);
    }
    if (entry.listeners.size === 0 && entry.snapshot === null) entries.delete(key);
  });
}

export function getLoanRecordSnapshot(location: LoanRecordLocation) {
  return entries.get(locationKey(location))?.snapshot ?? null;
}

export function subscribeToLoanRecords(
  location: LoanRecordLocation,
  consumerId: string,
  listener: () => void,
) {
  const key = locationKey(location);
  const entry = entryFor(location);
  entry.listeners.set(consumerId, listener);
  if (!entry.consumerDigests.has(consumerId)) entry.consumerDigests.set(consumerId, null);
  return () => {
    if (entry.listeners.get(consumerId) === listener) {
      entry.listeners.delete(consumerId);
      entry.consumerDigests.delete(consumerId);
      scheduleConfirmedCleanup(key, entry);
    }
  };
}

export function publishLoanRecords(
  location: LoanRecordLocation,
  records: readonly ExistingLoanRecord[],
  previouslyVisibleRecords: readonly ExistingLoanRecord[],
) {
  const entry = entryFor(location);
  const staleDigests = new Set(entry.snapshot?.staleDigests ?? []);
  if (entry.snapshot) staleDigests.add(entry.snapshot.digest);
  staleDigests.add(loanRecordsDigest(previouslyVisibleRecords));
  entry.snapshot = {
    records: [...records],
    digest: loanRecordsDigest(records),
    staleDigests,
  };
  retainEntry(location, entry);
  notify(entry);
}

export function resolveLoanRecords(
  snapshot: LoanRecordSnapshot | null,
  incomingRecords: readonly ExistingLoanRecord[],
): LoanRecordResolution {
  if (!snapshot) return { records: incomingRecords, disposition: "none" };
  const incomingDigest = loanRecordsDigest(incomingRecords);
  if (incomingDigest === snapshot.digest) {
    return { records: snapshot.records, disposition: "confirmed" };
  }
  if (snapshot.staleDigests.has(incomingDigest)) {
    return { records: snapshot.records, disposition: "stale-props" };
  }
  return { records: incomingRecords, disposition: "newer-props" };
}

export function acknowledgeLoanRecordProps(
  location: LoanRecordLocation,
  consumerId: string,
  expectedSnapshot: LoanRecordSnapshot,
  incomingRecords: readonly ExistingLoanRecord[],
  disposition: LoanRecordResolution["disposition"],
) {
  const key = locationKey(location);
  const entry = entries.get(key);
  if (!entry || entry.snapshot !== expectedSnapshot) return;
  const incomingDigest = loanRecordsDigest(incomingRecords);
  if (disposition === "newer-props") {
    const staleDigests = new Set(expectedSnapshot.staleDigests);
    staleDigests.add(expectedSnapshot.digest);
    entry.snapshot = {
      records: [...incomingRecords],
      digest: incomingDigest,
      staleDigests,
    };
    retainEntry(location, entry);
    notify(entry);
  }
  entry.consumerDigests.set(consumerId, incomingDigest);
  scheduleConfirmedCleanup(key, entry);
}

export function loanRecordSyncEntryCount() {
  return entries.size;
}

export function clearLoanRecordSyncState() {
  entries.clear();
}
