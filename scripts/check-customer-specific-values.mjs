import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PRODUCT_SCOPES = ["app", "worker", "supabase", "scripts", "tools"];
const COMPANY_NAME = ["서울", "경영"].join("");
const BOARD_IDS = [
  ["1816", "794539"],
  ["1816", "794566"],
  ["1814", "266449"],
  ["5025", "540159"],
  ["5025", "608070"],
  ["5025", "609084"],
  ["5025", "609199"],
  ["1816", "856300"],
].map((parts) => parts.join(""));
const FORBIDDEN = [COMPANY_NAME, ...BOARD_IDS];
const IGNORED_DIRECTORIES = new Set(["node_modules", ".next", "coverage", "dist", "build"]);

async function* filesBelow(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* filesBelow(entryPath);
    else if (entry.isFile()) yield entryPath;
  }
}

export async function findCustomerSpecificValues(root, scopes = PRODUCT_SCOPES) {
  const violations = [];
  for (const scope of scopes) {
    const scopePath = path.join(root, scope);
    for await (const filePath of filesBelow(scopePath)) {
      const lines = (await readFile(filePath, "utf8")).split(/\r?\n/u);
      for (let index = 0; index < lines.length; index += 1) {
        for (const value of FORBIDDEN) {
          if (lines[index].includes(value)) violations.push({ filePath, line: index + 1, value });
        }
      }
    }
  }
  return violations;
}

async function selfTest() {
  const root = await mkdtemp(path.join(os.tmpdir(), "moawork-customer-values-"));
  try {
    const scopePath = path.join(root, "app");
    await mkdir(scopePath);
    await writeFile(path.join(scopePath, "clean.ts"), "export const customer = '첫 고객';\n");
    assert.deepEqual(await findCustomerSpecificValues(root, ["app"]), []);

    await writeFile(path.join(scopePath, "leak.ts"), `export const leaked = '${BOARD_IDS[0]}';\n`);
    const violations = await findCustomerSpecificValues(root, ["app"]);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 1);
    assert.equal(violations[0].value, BOARD_IDS[0]);

    await writeFile(path.join(scopePath, "leak.ts"), `export const leaked = '${COMPANY_NAME}';\n`);
    const companyViolations = await findCustomerSpecificValues(root, ["app"]);
    assert.equal(companyViolations.length, 1);
    assert.equal(companyViolations[0].value, COMPANY_NAME);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log("customer-specific value check self-test: PASS");
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const violations = await findCustomerSpecificValues(root);
  if (violations.length === 0) {
    console.log("customer-specific value check: PASS");
    return;
  }

  console.error("customer-specific value check: FAIL");
  for (const violation of violations) {
    console.error(`${path.relative(root, violation.filePath)}:${violation.line}: forbidden customer-specific value`);
  }
  process.exitCode = 1;
}

await main();
