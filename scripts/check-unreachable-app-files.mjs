import fs from "node:fs";
import path from "node:path";
import ts from "../node_modules/typescript/lib/typescript.js";

const root = path.resolve("app/src");
const sourceExtensions = [".ts", ".tsx"];
const specialFiles = new Set([
  "page.tsx", "page.ts", "layout.tsx", "layout.ts", "route.ts", "route.tsx",
  "loading.tsx", "loading.ts", "error.tsx", "error.ts", "not-found.tsx",
  "not-found.ts", "template.tsx", "template.ts", "default.tsx", "default.ts",
]);

// BBE-241: these modules are deliberately waiting for their product surface.
// Reachability alone must never turn them into deletion candidates.
const protectedLandingFiles = [
  "app/src/components/dashboard/perf-widgets.tsx",
  "app/src/components/send-guard/SendConfirmDialog.tsx",
  "app/src/lib/campaign/index.ts", "app/src/lib/campaign/server.ts",
  "app/src/lib/campaign/service.ts", "app/src/lib/campaign/supabase.ts",
  "app/src/lib/campaign/types.ts",
  "app/src/lib/company/handoff.ts", "app/src/lib/company/index.ts",
  "app/src/lib/company/supabase-handoff.ts",
  "app/src/lib/messaging/index.ts", "app/src/lib/messaging/service.ts",
  "app/src/lib/messaging/triggers.ts", "app/src/lib/messaging/types.ts",
  "app/src/lib/org/notification-routing.ts", "app/src/lib/org/reporting.ts",
  "app/src/lib/perf/aggregate.ts", "app/src/lib/perf/index.ts",
  "app/src/lib/perf/service.ts", "app/src/lib/perf/types.ts",
  "app/src/lib/policyfund/reject/index.ts", "app/src/lib/policyfund/reject/ledger.ts",
  "app/src/lib/policyfund/reject/types.ts",
  "app/src/lib/send-guard/catalog.ts", "app/src/lib/send-guard/confirm.ts",
  "app/src/lib/send-guard/exclusions.ts", "app/src/lib/send-guard/history.ts",
  "app/src/lib/send-guard/index.ts", "app/src/lib/send-guard/plan.ts",
  "app/src/lib/send-guard/template.ts", "app/src/lib/send-guard/ticket.ts",
  "app/src/lib/send-guard/types.ts",
];

const missingProtected = protectedLandingFiles.filter((file) => !fs.existsSync(path.resolve(file)));
if (missingProtected.length) {
  console.error(`BBE-241 protected landing files were removed:\n${missingProtected.join("\n")}`);
  process.exit(1);
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

const all = walk(root)
  .filter((file) => sourceExtensions.includes(path.extname(file)))
  .filter((file) => !/\.(?:test|spec)\.[jt]sx?$/.test(file));
const allSet = new Set(all.map((file) => path.normalize(file)));

function resolveSource(fromFile, specifier) {
  if (!(specifier.startsWith("@/") || specifier.startsWith("."))) return null;
  const base = specifier.startsWith("@/")
    ? path.join(root, specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...sourceExtensions.map((extension) => `${base}${extension}`),
    ...sourceExtensions.map((extension) => path.join(base, `index${extension}`)),
  ];
  return candidates.map(path.normalize).find((candidate) => allSet.has(candidate)) ?? null;
}

function dependencies(file) {
  const text = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const result = new Set();
  function visit(node) {
    let value = null;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      value = node.moduleSpecifier.text;
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      value = node.arguments[0].text;
    }
    if (value) {
      const resolved = resolveSource(file, value);
      if (resolved) result.add(resolved);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

const roots = all.filter((file) => {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  return relative === "proxy.ts" || (relative.startsWith("app/") && specialFiles.has(path.basename(file)));
});
const reached = new Set(roots.map(path.normalize));
const queue = [...reached];
while (queue.length) {
  const current = queue.shift();
  for (const dependency of dependencies(current)) {
    if (!reached.has(dependency)) {
      reached.add(dependency);
      queue.push(dependency);
    }
  }
}

const unreachable = all
  .filter((file) => !reached.has(path.normalize(file)))
  .map((file) => path.relative(process.cwd(), file).replaceAll("\\", "/"))
  .sort();

console.log(JSON.stringify({
  roots: roots.length,
  sourceFiles: all.length,
  reached: reached.size,
  unreachable: unreachable.length,
  protectedLandingFiles: protectedLandingFiles.length,
  files: unreachable,
}, null, 2));
