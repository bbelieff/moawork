import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectGuardedMigration } from "./check-migration-guards.mjs";

export function validateIdentity({ executor, thread, head }) {
  if (!/^(?:DG|DC|NG|NC)-\d{2}$/u.test(executor)) throw new Error("executor must be an exact owner label");
  if (!/^[0-9a-f-]{20,}$/u.test(thread)) throw new Error("thread must be an exact thread id");
  if (!/^[0-9a-f]{40}$/u.test(head)) throw new Error("head must be a full commit SHA");
}

export function validatePostflight(metadata, readback) {
  const expected = {
    logicalKey: metadata.logicalKey,
    fileName: metadata.fileName,
    fileDigest: metadata.digest,
    expectedPredecessor: metadata.predecessor,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (readback[key] !== value) throw new Error(`postflight ${key} mismatch`);
  }
  if (readback.guardCount !== 1 || readback.historyCount !== 1) throw new Error("postflight requires guard1/history1");
  if (!Array.isArray(readback.historyVersions) || readback.historyVersions.length !== 1) throw new Error("postflight requires exactly one history version");
  if (!Array.isArray(readback.historyPayloadDigests) || readback.historyPayloadDigests.length !== 1 || readback.historyPayloadDigests[0] !== metadata.digest) {
    throw new Error("postflight history payload digest mismatch");
  }
  if (readback.customerDmlCount !== 0) throw new Error("postflight customer DML must remain zero");
  return { ...expected, guardCount: 1, historyCount: 1, historyVersions: readback.historyVersions, historyPayloadDigests: readback.historyPayloadDigests, customerDmlCount: 0 };
}

function args(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 2) out[argv[index]?.replace(/^--/u, "")] = argv[index + 1];
  return out;
}

async function main() {
  const input = args(process.argv.slice(2));
  validateIdentity(input);
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const file = resolve(input.file ?? "");
  if (!file.startsWith(resolve(root, "supabase", "migrations"))) throw new Error("file must be a repository migration");
  const actualHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (actualHead !== input.head) throw new Error("HEAD does not match approved exact");
  if (execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()) throw new Error("worktree must be clean");
  const metadata = inspectGuardedMigration(basename(file), await readFile(file, "utf8"));
  if (input.mode === "preflight") {
    console.log(JSON.stringify({ mode: "preflight", executor: input.executor, thread: input.thread, head: input.head, ...metadata }));
    return;
  }
  if (input.mode !== "postflight") throw new Error("mode must be preflight or postflight");
  const readback = JSON.parse(await readFile(resolve(input.readback ?? ""), "utf8"));
  console.log(JSON.stringify({ mode: "postflight", executor: input.executor, thread: input.thread, head: input.head, ...validatePostflight(metadata, readback) }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
