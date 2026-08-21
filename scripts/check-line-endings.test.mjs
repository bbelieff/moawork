import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

function normalizeSourceText(source) {
  return source.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
}

function replaceExactlyOnce(source, anchor, replacement) {
  const normalized = normalizeSourceText(source);
  const matches = normalized.split(anchor).length - 1;
  assert.equal(matches, 1, `mutation anchor must match exactly once, found ${matches}`);
  return normalized.replace(anchor, replacement);
}

test("future source checkouts are explicitly canonical LF", async () => {
  const attributes = normalizeSourceText(await readFile(new URL("../.gitattributes", import.meta.url), "utf8"));
  for (const pattern of [".gitattributes", "*.ts", "*.tsx", "*.json", "*.css"]) {
    assert.equal(
      attributes.split("\n").filter((line) => line.trim().startsWith(`${pattern} `) && /\btext\s+eol=lf\s*$/u.test(line)).length,
      1,
      `${pattern} must have one LF rule`,
    );
  }

  const probes = ["fixture.ts", "fixture.tsx", "fixture.json", "fixture.css"];
  const output = execFileSync("git", ["check-attr", "text", "eol", "--", ...probes], {
    cwd: root,
    encoding: "utf8",
  });
  for (const probe of probes) {
    assert.match(output, new RegExp(`^${probe}: text: set\\r?\\n${probe}: eol: lf$`, "mu"));
  }
});

test("source inspection and mutation anchors behave identically for LF and CRLF", () => {
  const lf = [
    "export async function routeRequest() {",
    "  return { kind: \"pass\" };",
    "}",
    "",
  ].join("\n");
  const crlf = lf.replace(/\n/gu, "\r\n");
  const anchor = "  return { kind: \"pass\" };";
  const replacement = "  return { kind: \"redirect\" };";

  assert.equal(normalizeSourceText(crlf), normalizeSourceText(lf));
  assert.equal(replaceExactlyOnce(crlf, anchor, replacement), replaceExactlyOnce(lf, anchor, replacement));
  assert.throws(() => replaceExactlyOnce("no anchor\r\n", anchor, replacement), /exactly once, found 0/u);
  assert.throws(() => replaceExactlyOnce(`${lf}${lf}`, anchor, replacement), /exactly once, found 2/u);
});
