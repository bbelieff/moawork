#!/usr/bin/env node
// check-server-client-boundary.mjs — server graph에서 "use client" export를 실행하는 호출을 센다.
//
// Next.js는 서버 컴포넌트가 클라이언트 컴포넌트를 JSX로 렌더하는 것은 허용하지만,
// 클라이언트 경계에서 export한 함수/값을 서버에서 직접 호출하면 런타임에 500으로 실패한다.
// 이 형태는 tsc, vitest, next build가 모두 통과할 수 있으므로 실제 페이지를 열기 전에 잡는다.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);
const DEFAULT_REPO_ROOT = resolve(dirname(THIS_FILE), "..");
const requireFromApp = createRequire(join(DEFAULT_REPO_ROOT, "app", "package.json"));
const ts = requireFromApp("typescript");

const slash = (value) => value.split(sep).join("/");
const keyOf = (value) => slash(resolve(value)).toLowerCase();
const isInside = (file, directory) => {
  const rel = relative(directory, file);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

function hasDirective(sourceFile, directive) {
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === directive) return true;
  }
  return false;
}

function isProductionSource(file) {
  const normalized = slash(file);
  return /\.(?:ts|tsx)$/.test(normalized)
    && !/\.(?:test|spec|stories)\.(?:ts|tsx)$/.test(normalized)
    && !normalized.endsWith(".d.ts");
}

function isServerEntry(sourceFile, scanRoot) {
  if (hasDirective(sourceFile, "use server")) return true;
  const rel = slash(relative(scanRoot, sourceFile.fileName));
  if (rel === "proxy.ts" || rel === "proxy.tsx") return true;
  if (rel === "instrumentation.ts" || rel === "instrumentation.tsx") return true;
  if (!rel.startsWith("app/")) return false;
  return /\/(?:page|layout|route|default|loading|not-found|forbidden|unauthorized|template|error|global-error|sitemap|robots|manifest|(?:icon|apple-icon|opengraph-image|twitter-image)\d?)\.(?:ts|tsx)$/.test(`/${rel}`);
}

function readProjectConfig(appRoot) {
  const configPath = join(appRoot, "tsconfig.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) return { errors: [read.error] };
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    appRoot,
    { noEmit: true, incremental: false },
    configPath,
  );
  return { parsed, errors: parsed.errors };
}

function formatDiagnosticMessage(diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, " ").replace(/\s+/g, " ").trim();
}

function diagnosticPosition(diagnostic, projectRoot) {
  if (!diagnostic.file || diagnostic.start === undefined) {
    return { file: "app/tsconfig.json", line: 1, column: 1 };
  }
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return {
    file: slash(relative(projectRoot, diagnostic.file.fileName)),
    line: position.line + 1,
    column: position.character + 1,
  };
}

function collectModuleSpecifiers(sourceFile) {
  const specifiers = [];
  const hasRuntimeImport = (statement) => {
    const clause = statement.importClause;
    if (!clause) return true;
    if (clause.isTypeOnly) return false;
    if (clause.name) return true;
    const bindings = clause.namedBindings;
    if (!bindings || ts.isNamespaceImport(bindings)) return true;
    return bindings.elements.length === 0 || bindings.elements.some((element) => !element.isTypeOnly);
  };
  const hasRuntimeExport = (statement) => {
    if (statement.isTypeOnly) return false;
    const clause = statement.exportClause;
    if (!clause || ts.isNamespaceExport(clause)) return true;
    return clause.elements.length === 0 || clause.elements.some((element) => !element.isTypeOnly);
  };
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node)
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
      && hasRuntimeImport(node)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node)
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
      && hasRuntimeExport(node)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * @param {{ projectRoot?: string }} options
 */
export function scanServerClientBoundary(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? DEFAULT_REPO_ROOT);
  const appRoot = join(projectRoot, "app");
  const scanRoot = join(appRoot, "src");
  const config = readProjectConfig(appRoot);
  const unknowns = [];

  for (const diagnostic of config.errors ?? []) {
    const position = diagnosticPosition(diagnostic, projectRoot);
    unknowns.push({
      code: "SERVER_CLIENT_CONFIG",
      ...position,
      message: `TS${diagnostic.code} ${formatDiagnosticMessage(diagnostic)}`,
    });
  }
  if (!config.parsed) {
    return { clientFiles: 0, serverRoots: 0, serverFiles: 0, violations: [], unknowns };
  }

  const program = ts.createProgram({ rootNames: config.parsed.fileNames, options: config.parsed.options });
  const checker = program.getTypeChecker();
  const sourceFiles = program.getSourceFiles().filter(
    (sourceFile) => isInside(sourceFile.fileName, scanRoot) && /\.(?:ts|tsx)$/.test(sourceFile.fileName) && !sourceFile.isDeclarationFile,
  );
  const byKey = new Map(sourceFiles.map((sourceFile) => [keyOf(sourceFile.fileName), sourceFile]));
  const clientKeys = new Set(sourceFiles.filter((sourceFile) => hasDirective(sourceFile, "use client")).map((sourceFile) => keyOf(sourceFile.fileName)));

  const moduleResolutionCache = ts.createModuleResolutionCache(appRoot, (file) => file.toLowerCase(), config.parsed.options);
  const resolveModule = (sourceFile, specifier) => {
    const resolved = ts.resolveModuleName(
      specifier,
      sourceFile.fileName,
      config.parsed.options,
      ts.sys,
      moduleResolutionCache,
    ).resolvedModule?.resolvedFileName;
    if (!resolved || !isInside(resolved, scanRoot)) return null;
    const key = keyOf(resolved.replace(/\.d\.ts$/, ".ts"));
    return byKey.has(key) ? key : null;
  };

  const dependencies = new Map();
  for (const sourceFile of sourceFiles) {
    const deps = new Set();
    for (const specifier of collectModuleSpecifiers(sourceFile)) {
      const target = resolveModule(sourceFile, specifier);
      if (target) deps.add(target);
    }
    dependencies.set(keyOf(sourceFile.fileName), deps);
  }

  const rootKeys = sourceFiles
    .filter((sourceFile) => isProductionSource(sourceFile.fileName) && !clientKeys.has(keyOf(sourceFile.fileName)) && isServerEntry(sourceFile, scanRoot))
    .map((sourceFile) => keyOf(sourceFile.fileName));
  const serverKeys = new Set();
  const queue = [...rootKeys];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || serverKeys.has(current) || clientKeys.has(current)) continue;
    serverKeys.add(current);
    for (const dependency of dependencies.get(current) ?? []) {
      if (!clientKeys.has(dependency) && !serverKeys.has(dependency)) queue.push(dependency);
    }
  }

  const exportTraceCache = new Map();
  const traceClientExport = (moduleKey, exportName, seen = new Set()) => {
    const cacheKey = `${moduleKey}::${exportName}`;
    if (exportTraceCache.has(cacheKey)) return exportTraceCache.get(cacheKey);
    if (clientKeys.has(moduleKey)) {
      const result = { clientKey: moduleKey, exportName };
      exportTraceCache.set(cacheKey, result);
      return result;
    }
    if (seen.has(cacheKey)) return null;
    const nextSeen = new Set(seen).add(cacheKey);
    const sourceFile = byKey.get(moduleKey);
    if (!sourceFile) return null;

    const importedLocals = new Map();
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue;
      const target = ts.isStringLiteral(statement.moduleSpecifier)
        ? resolveModule(sourceFile, statement.moduleSpecifier.text)
        : null;
      if (!target) continue;
      if (statement.importClause.name) importedLocals.set(statement.importClause.name.text, { target, name: "default" });
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (!element.isTypeOnly) importedLocals.set(element.name.text, { target, name: element.propertyName?.text ?? element.name.text });
        }
      }
    }

    for (const statement of sourceFile.statements) {
      if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
      const target = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? resolveModule(sourceFile, statement.moduleSpecifier.text)
        : null;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (element.isTypeOnly || element.name.text !== exportName) continue;
          const upstreamName = element.propertyName?.text ?? element.name.text;
          const direct = target ? traceClientExport(target, upstreamName, nextSeen) : null;
          if (direct) {
            exportTraceCache.set(cacheKey, direct);
            return direct;
          }
          const imported = importedLocals.get(upstreamName);
          if (imported) {
            const traced = traceClientExport(imported.target, imported.name, nextSeen);
            if (traced) {
              exportTraceCache.set(cacheKey, traced);
              return traced;
            }
          }
        }
      } else if (!statement.exportClause && target) {
        const traced = traceClientExport(target, exportName, nextSeen);
        if (traced) {
          exportTraceCache.set(cacheKey, traced);
          return traced;
        }
      }
    }
    exportTraceCache.set(cacheKey, null);
    return null;
  };

  const namespaceExportTraceCache = new Map();
  const traceNamespaceExport = (moduleKey, exportName, seen = new Set()) => {
    const cacheKey = `${moduleKey}::${exportName}`;
    if (namespaceExportTraceCache.has(cacheKey)) return namespaceExportTraceCache.get(cacheKey);
    if (seen.has(cacheKey)) return null;
    const sourceFile = byKey.get(moduleKey);
    if (!sourceFile) return null;
    const nextSeen = new Set(seen).add(cacheKey);

    const importedNamespaces = new Map();
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue;
      const target = ts.isStringLiteral(statement.moduleSpecifier)
        ? resolveModule(sourceFile, statement.moduleSpecifier.text)
        : null;
      const bindings = statement.importClause.namedBindings;
      if (target && bindings && ts.isNamespaceImport(bindings)) importedNamespaces.set(bindings.name.text, target);
    }

    for (const statement of sourceFile.statements) {
      if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
      const target = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? resolveModule(sourceFile, statement.moduleSpecifier.text)
        : null;
      if (statement.exportClause && ts.isNamespaceExport(statement.exportClause)) {
        if (statement.exportClause.name.text === exportName && target) {
          const result = { moduleKey: target };
          namespaceExportTraceCache.set(cacheKey, result);
          return result;
        }
      } else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (element.isTypeOnly || element.name.text !== exportName) continue;
          const upstreamName = element.propertyName?.text ?? element.name.text;
          const direct = target ? traceNamespaceExport(target, upstreamName, nextSeen) : null;
          if (direct) {
            namespaceExportTraceCache.set(cacheKey, direct);
            return direct;
          }
          const imported = importedNamespaces.get(upstreamName);
          if (imported) {
            const result = { moduleKey: imported };
            namespaceExportTraceCache.set(cacheKey, result);
            return result;
          }
        }
      } else if (!statement.exportClause && target) {
        const traced = traceNamespaceExport(target, exportName, nextSeen);
        if (traced) {
          namespaceExportTraceCache.set(cacheKey, traced);
          return traced;
        }
      }
    }
    namespaceExportTraceCache.set(cacheKey, null);
    return null;
  };

  const namespaceClientCache = new Map();
  const namespaceMayExposeClient = (moduleKey, seen = new Set()) => {
    if (clientKeys.has(moduleKey)) return true;
    if (namespaceClientCache.has(moduleKey)) return namespaceClientCache.get(moduleKey);
    if (seen.has(moduleKey)) return false;
    const sourceFile = byKey.get(moduleKey);
    if (!sourceFile) return false;
    const nextSeen = new Set(seen).add(moduleKey);

    for (const statement of sourceFile.statements) {
      if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
      const target = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? resolveModule(sourceFile, statement.moduleSpecifier.text)
        : null;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (!element.isTypeOnly && traceClientExport(moduleKey, element.name.text)) {
            namespaceClientCache.set(moduleKey, true);
            return true;
          }
        }
      } else if (target && namespaceMayExposeClient(target, nextSeen)) {
        namespaceClientCache.set(moduleKey, true);
        return true;
      }
    }
    namespaceClientCache.set(moduleKey, false);
    return false;
  };

  const violations = [];
  for (const sourceFile of sourceFiles) {
    const sourceKey = keyOf(sourceFile.fileName);
    if (!serverKeys.has(sourceKey) || !isProductionSource(sourceFile.fileName)) continue;

    const bindings = new Map();
    const bind = (identifier, value) => {
      const symbol = checker.getSymbolAtLocation(identifier);
      if (symbol) bindings.set(symbol, value);
    };
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue;
      const target = ts.isStringLiteral(statement.moduleSpecifier)
        ? resolveModule(sourceFile, statement.moduleSpecifier.text)
        : null;
      if (!target) continue;
      if (statement.importClause.name) {
        const traced = traceClientExport(target, "default");
        if (traced) bind(statement.importClause.name, { kind: "value", ...traced, access: [] });
      }
      const named = statement.importClause.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          if (element.isTypeOnly) continue;
          const importedName = element.propertyName?.text ?? element.name.text;
          const namespace = traceNamespaceExport(target, importedName);
          if (namespace) {
            bind(element.name, { kind: "namespace", ...namespace, access: [] });
            continue;
          }
          const traced = traceClientExport(target, importedName);
          if (traced) bind(element.name, { kind: "value", ...traced, access: [] });
        }
      } else if (named && ts.isNamespaceImport(named)) {
        bind(named.name, { kind: "namespace", moduleKey: target, access: [] });
      }
    }

    const resolvePropertyBinding = (base, property) => {
      if (base.kind === "namespace") {
        if (property === "<dynamic>") {
          return namespaceMayExposeClient(base.moduleKey)
            ? { kind: "dynamic", moduleKey: base.moduleKey, access: [property] }
            : null;
        }
        const namespace = traceNamespaceExport(base.moduleKey, property);
        if (namespace) return { kind: "namespace", ...namespace, access: [] };
        const traced = traceClientExport(base.moduleKey, property);
        return traced ? { kind: "value", ...traced, access: [] } : null;
      }
      return { ...base, access: [...base.access, property] };
    };

    const resolveBinding = (expression) => {
      const node = unwrapExpression(expression);
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        return symbol ? bindings.get(symbol) ?? null : null;
      }
      if (ts.isPropertyAccessExpression(node)) {
        const base = resolveBinding(node.expression);
        if (!base) return null;
        return resolvePropertyBinding(base, node.name.text);
      }
      if (ts.isElementAccessExpression(node)) {
        const base = resolveBinding(node.expression);
        if (!base) return null;
        const argument = node.argumentExpression;
        const property = argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
          ? argument.text
          : "<dynamic>";
        return resolvePropertyBinding(base, property);
      }
      return null;
    };

    const bindingPropertyName = (name) => {
      if (!name) return null;
      if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
      return "<dynamic>";
    };

    const bindAliasPattern = (name, resolved) => {
      if (ts.isIdentifier(name)) {
        const symbol = checker.getSymbolAtLocation(name);
        if (symbol && !bindings.has(symbol)) {
          bindings.set(symbol, resolved);
          return true;
        }
        return false;
      }
      let didBind = false;
      if (ts.isObjectBindingPattern(name)) {
        for (const element of name.elements) {
          const child = element.dotDotDotToken
            ? resolved
            : resolvePropertyBinding(resolved, bindingPropertyName(element.propertyName ?? element.name));
          if (child && bindAliasPattern(element.name, child)) didBind = true;
        }
      } else if (ts.isArrayBindingPattern(name)) {
        name.elements.forEach((element, index) => {
          if (!ts.isBindingElement(element)) return;
          const child = element.dotDotDotToken ? resolved : resolvePropertyBinding(resolved, String(index));
          if (child && bindAliasPattern(element.name, child)) didBind = true;
        });
      }
      return didBind;
    };

    // Direct import aliases are common enough to cover explicitly; fixed point handles alias chains.
    let changed = true;
    while (changed) {
      changed = false;
      const visitAliases = (node) => {
        if (ts.isVariableDeclaration(node) && node.initializer) {
          const resolved = resolveBinding(node.initializer);
          if (resolved && bindAliasPattern(node.name, resolved)) changed = true;
        }
        ts.forEachChild(node, visitAliases);
      };
      visitAliases(sourceFile);
    }

    const record = (node, binding, invocation) => {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const targetKey = binding.clientKey ?? binding.moduleKey;
      const targetFile = byKey.get(targetKey)?.fileName ?? targetKey;
      const imported = binding.exportName
        ? [binding.exportName, ...(binding.access ?? [])].join(".")
        : (binding.access ?? ["<dynamic>"]).join(".");
      violations.push({
        code: binding.kind === "dynamic" ? "SERVER_CLIENT_DYNAMIC_CALL" : "SERVER_CLIENT_CALL",
        file: slash(relative(projectRoot, sourceFile.fileName)),
        line: start.line + 1,
        column: start.character + 1,
        imported,
        target: slash(relative(projectRoot, targetFile)),
        invocation,
      });
    };

    const visitCalls = (node) => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const binding = resolveBinding(node.expression);
        if (binding) record(node.expression, binding, ts.isNewExpression(node) ? "new" : "call");
      } else if (ts.isTaggedTemplateExpression(node)) {
        const binding = resolveBinding(node.tag);
        if (binding) record(node.tag, binding, "tag");
      }
      ts.forEachChild(node, visitCalls);
    };
    visitCalls(sourceFile);
  }

  for (const diagnostic of program.getSyntacticDiagnostics()) {
    if (!diagnostic.file || !isInside(diagnostic.file.fileName, scanRoot) || !isProductionSource(diagnostic.file.fileName)) continue;
    const position = diagnosticPosition(diagnostic, projectRoot);
    unknowns.push({
      code: "SERVER_CLIENT_PARSE",
      ...position,
      message: `TS${diagnostic.code} ${formatDiagnosticMessage(diagnostic)}`,
    });
  }

  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.imported.localeCompare(b.imported));
  unknowns.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  return {
    clientFiles: clientKeys.size,
    serverRoots: rootKeys.length,
    serverFiles: serverKeys.size,
    violations,
    unknowns,
  };
}

export function formatFinding(finding) {
  if (finding.code === "SERVER_CLIENT_CALL" || finding.code === "SERVER_CLIENT_DYNAMIC_CALL") {
    return `${finding.code} ${finding.file}:${finding.line}:${finding.column} ${finding.imported} (${finding.invocation}) -> ${finding.target}`;
  }
  return `${finding.code} ${finding.file}:${finding.line}:${finding.column} ${finding.message}`;
}

function parseProjectRoot(argv) {
  const index = argv.indexOf("--project-root");
  if (index === -1) return DEFAULT_REPO_ROOT;
  if (!argv[index + 1]) throw new Error("--project-root requires a path");
  return resolve(argv[index + 1]);
}

function main() {
  let projectRoot;
  try {
    projectRoot = parseProjectRoot(process.argv.slice(2));
  } catch (error) {
    console.error(`SERVER_CLIENT_USAGE ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  const result = scanServerClientBoundary({ projectRoot });
  for (const finding of [...result.violations, ...result.unknowns]) console.error(formatFinding(finding));
  console.log(
    `server-client boundary: ${result.clientFiles} client file(s), ${result.serverRoots} server root(s), ${result.serverFiles} server-reachable file(s), ${result.violations.length} violation(s), ${result.unknowns.length} unknown(s)`,
  );
  if (result.violations.length > 0 || result.unknowns.length > 0) {
    console.error('❌ 서버에서 "use client" export를 함수처럼 실행하면 런타임 500이 난다.');
    console.error("   순수 로직을 server-safe 모듈로 옮기고, 클라이언트 컴포넌트는 JSX로만 렌더하라.");
    process.exit(1);
  }
}

if (resolve(process.argv[1] ?? "") === resolve(THIS_FILE)) main();
