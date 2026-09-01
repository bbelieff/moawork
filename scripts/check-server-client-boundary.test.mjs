import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { formatFinding, scanServerClientBoundary } from "./check-server-client-boundary.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const checker = join(HERE, "check-server-client-boundary.mjs");
const fixtures = join(HERE, "fixtures", "server-client-boundary");

const scan = (name) => scanServerClientBoundary({ projectRoot: join(fixtures, name) });

test("server may render a client component while client-only consumers stay outside the server graph", () => {
  const result = scan("good");

  assert.equal(result.clientFiles, 2);
  assert.equal(result.serverRoots, 1);
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.unknowns, []);
});

test("server-reachable direct, alias, destructured, namespace/barrel, metadata, dynamic, tag, and server-action calls fail closed", () => {
  const result = scan("bad");

  assert.deepEqual(
    result.violations.map(({ file, imported, invocation }) => ({ file, imported, invocation })),
    [
      { file: "app/src/app/alias/page.tsx", imported: "clientHelper", invocation: "call" },
      { file: "app/src/app/apple-icon.tsx", imported: "clientHelper", invocation: "call" },
      { file: "app/src/app/barrel/page.tsx", imported: "clientHelper", invocation: "call" },
      { file: "app/src/app/constant/page.tsx", imported: "CLIENT_RULES.includes", invocation: "call" },
      { file: "app/src/app/destructure/page.tsx", imported: "clientHelper", invocation: "call" },
      { file: "app/src/app/direct/page.tsx", imported: "clientHelper", invocation: "call" },
      { file: "app/src/app/dynamic/page.tsx", imported: "<dynamic>", invocation: "call" },
      { file: "app/src/app/icon.tsx", imported: "clientHelper", invocation: "call" },
      { file: "app/src/app/namespace-barrel/page.tsx", imported: "clientHelper", invocation: "call" },
      { file: "app/src/app/namespace/page.tsx", imported: "clientHelper", invocation: "call" },
      { file: "app/src/app/tag/page.tsx", imported: "clientHelper", invocation: "tag" },
      { file: "app/src/lib/server-action.ts", imported: "clientHelper", invocation: "call" },
    ],
  );
  assert.deepEqual(result.unknowns, []);
  assert.match(formatFinding(result.violations[0]), /^SERVER_CLIENT_CALL app\/src\/app\/alias\/page\.tsx:\d+:\d+ clientHelper \(call\) -> app\/src\/components\/ClientBoundary\.tsx$/);
  assert.equal(result.violations.some(({ file }) => file.includes("/safe/")), false);
});

test("syntax errors in production server files are unknown and fail closed", () => {
  const result = scan("invalid");

  assert.deepEqual(result.violations, []);
  assert.equal(result.unknowns.length > 0, true);
  assert.equal(result.unknowns.every(({ code }) => code === "SERVER_CLIENT_PARSE"), true);
});

test("CLI returns stable success and failure exit codes for executable fixtures", () => {
  const good = spawnSync(process.execPath, [checker, "--project-root", resolve(fixtures, "good")], { encoding: "utf8" });
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /0 violation\(s\), 0 unknown\(s\)/);

  const bad = spawnSync(process.execPath, [checker, "--project-root", resolve(fixtures, "bad")], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /SERVER_CLIENT_CALL app\/src\/app\/direct\/page\.tsx:/);
  assert.match(bad.stderr, /SERVER_CLIENT_DYNAMIC_CALL app\/src\/app\/dynamic\/page\.tsx:/);
  assert.match(bad.stderr, /서버에서 "use client" export/);

  const invalid = spawnSync(process.execPath, [checker, "--project-root", resolve(fixtures, "invalid")], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /SERVER_CLIENT_PARSE app\/src\/app\/page\.tsx:/);
});
