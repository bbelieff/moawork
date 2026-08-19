#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const APP_SOURCE_ROOT = path.join(REPO_ROOT, "app", "src");
const BASELINE_PATH = path.join(REPO_ROOT, "scripts", "production-repo-boundary-baseline.json");
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const BASELINE_CEILING = 30;

const TEST_OR_FIXTURE_PATH = /(?:^|\/)(?:__tests__|__fixtures__|fixtures|test-fixtures|dev-fixtures)(?:\/|$)|\.(?:test|spec|stories)\.[jt]sx?$/;
const ENTRYPOINT_PATH = /\/app\/.*\/(?:page|layout|route|actions)\.[jt]sx?$/;
function slash(value) {
  return value.replaceAll("\\", "/");
}

function relative(filePath) {
  return slash(path.relative(REPO_ROOT, filePath));
}

function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.includes(path.extname(filePath));
}

function isAllowedTestOrFixture(filePath) {
  return TEST_OR_FIXTURE_PATH.test(slash(filePath));
}

function collectSourceFiles(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...collectSourceFiles(fullPath));
    else if (entry.isFile() && isSourceFile(fullPath) && !isAllowedTestOrFixture(fullPath)) result.push(fullPath);
  }
  return result.sort();
}

function resolveImport(fromFile, specifier) {
  let base;
  if (specifier.startsWith("@/")) base = path.join(APP_SOURCE_ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;

  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => existsSync(candidate) && isSourceFile(candidate)) ?? null;
}

function moduleKind(fromFile, specifier) {
  const resolved = resolveImport(fromFile, specifier);
  const normalized = resolved ? relative(resolved) : slash(specifier);
  if (normalized === "app/src/lib/repo/index.ts" || specifier === "@/lib/repo") return "repo-root";
  if (normalized.startsWith("app/src/lib/repo/local/") || /(?:^|\/)repo\/local(?:\/|$)/.test(normalized)) {
    return "repo-local";
  }
  return null;
}

function stringValue(node) {
  return ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function localBindingInitializer(sourceFile, name) {
  let initializer;
  function bindingContains(binding) {
    if (ts.isIdentifier(binding)) return binding.text === name;
    return binding.elements.some((element) => !ts.isOmittedExpression(element) && bindingContains(element.name));
  }
  function visit(node) {
    if (initializer !== undefined) return;
    if (ts.isVariableDeclaration(node) && bindingContains(node.name)) {
      initializer = ts.isIdentifier(node.name) ? (node.initializer ?? null) : null;
      return;
    }
    if (ts.isParameter(node) && bindingContains(node.name)) initializer = null;
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))
      && node.name?.text === name) initializer = null;
    if (ts.isImportClause(node) && node.name?.text === name) initializer = null;
    if (ts.isImportSpecifier(node) && node.name.text === name) initializer = null;
    if (ts.isNamespaceImport(node) && node.name.text === name) initializer = null;
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return initializer;
}

function isPositiveDevCondition(node, sourceFile) {
  if (ts.isParenthesizedExpression(node)) return isPositiveDevCondition(node.expression, sourceFile);
  if (ts.isIdentifier(node)) {
    if (!/^(?:devToolsEnabled|isDevFixtureEnabled|MOAWORK_DEV_FIXTURE)$/.test(node.text)) return false;
    const initializer = localBindingInitializer(sourceFile, node.text);
    return initializer === undefined || (initializer !== null && isPositiveDevCondition(initializer, sourceFile));
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    return /^(?:devToolsEnabled|isDevFixtureEnabled)$/.test(node.expression.text)
      && localBindingInitializer(sourceFile, node.expression.text) === undefined;
  }
  if (!ts.isBinaryExpression(node)) return false;
  const operator = node.operatorToken.kind;
  if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
    return isPositiveDevCondition(node.left, sourceFile) || isPositiveDevCondition(node.right, sourceFile);
  }
  if (operator === ts.SyntaxKind.BarBarToken) {
    return isPositiveDevCondition(node.left, sourceFile) && isPositiveDevCondition(node.right, sourceFile);
  }
  const equality = operator === ts.SyntaxKind.EqualsEqualsEqualsToken || operator === ts.SyntaxKind.EqualsEqualsToken;
  const inequality = operator === ts.SyntaxKind.ExclamationEqualsEqualsToken || operator === ts.SyntaxKind.ExclamationEqualsToken;
  if (!equality && !inequality) return false;
  const left = node.left;
  const right = node.right;
  const trueLiteral = (value) => value.kind === ts.SyntaxKind.TrueKeyword;
  const isNodeEnv = (value) => {
    if (localBindingInitializer(sourceFile, "process") !== undefined) return false;
    if (ts.isParenthesizedExpression(value)) return isNodeEnv(value.expression);
    if (ts.isPropertyAccessExpression(value)) {
      return value.name.text === "NODE_ENV"
        && ts.isPropertyAccessExpression(value.expression)
        && value.expression.name.text === "env"
        && ts.isIdentifier(value.expression.expression)
        && value.expression.expression.text === "process";
    }
    if (!ts.isElementAccessExpression(value)) return false;
    const key = value.argumentExpression;
    if (!key || !ts.isStringLiteralLike(key)) return false;
    if (key.text === "NODE_ENV") {
      const target = value.expression;
      return (ts.isPropertyAccessExpression(target)
          && target.name.text === "env"
          && ts.isIdentifier(target.expression)
          && target.expression.text === "process")
        || (ts.isElementAccessExpression(target)
          && ts.isIdentifier(target.expression)
          && target.expression.text === "process"
          && target.argumentExpression
          && ts.isStringLiteralLike(target.argumentExpression)
          && target.argumentExpression.text === "env");
    }
    return false;
  };
  if (equality && trueLiteral(right) && isPositiveDevCondition(left, sourceFile)) return true;
  if (equality && trueLiteral(left) && isPositiveDevCondition(right, sourceFile)) return true;
  const leftText = left.getText(sourceFile);
  const rightText = right.getText(sourceFile);
  if (equality) {
    return (isNodeEnv(left) && /^["']development["']$/.test(rightText))
      || (isNodeEnv(right) && /^["']development["']$/.test(leftText));
  }
  return (isNodeEnv(left) && /^["']production["']$/.test(rightText))
    || (isNodeEnv(right) && /^["']production["']$/.test(leftText));
}

function isInsideExplicitDevGuard(node, sourceFile) {
  for (let current = node.parent; current; current = current.parent) {
    let guard = null;
    if (ts.isConditionalExpression(current) && (node.pos >= current.whenTrue.pos && node.end <= current.whenTrue.end)) {
      guard = current.condition;
    } else if (ts.isIfStatement(current) && node.pos >= current.thenStatement.pos && node.end <= current.thenStatement.end) {
      guard = current.expression;
    } else if (
      ts.isBinaryExpression(current)
      && current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      && node.pos >= current.right.pos
      && node.end <= current.right.end
    ) {
      guard = current.left;
    }
    if (guard && isPositiveDevCondition(guard, sourceFile)) return true;
  }
  return false;
}

function expressionPath(expression) {
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return expressionPath(expression.right);
  }
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const target = expressionPath(expression.expression);
    return target ? `${target}.${expression.name.text}` : null;
  }
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
    const member = stringValue(expression.argumentExpression);
    const target = expressionPath(expression.expression);
    if (member && target) return `${target}.${member}`;
  }
  return null;
}

function callName(node) {
  const path = expressionPath(node.expression);
  return path?.endsWith(".call") || path?.endsWith(".apply") ? path.slice(0, path.lastIndexOf(".")) : path;
}

function constructorName(node) {
  let expression = node.expression;
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    return `${expression.expression.text}.${expression.name.text}`;
  }
  if (ts.isElementAccessExpression(expression) && ts.isIdentifier(expression.expression) && expression.argumentExpression) {
    const member = stringValue(expression.argumentExpression);
    if (member) return `${expression.expression.text}.${member}`;
  }
  return null;
}

function categoryFor(filePath) {
  const normalized = relative(filePath);
  if (ENTRYPOINT_PATH.test(`/${normalized}`)) return "entrypoint";
  if (normalized.startsWith("app/src/lib/repo/")) return "repo-factory";
  return "service-composition";
}

export function analyzeSource(sourceText, filePath) {
  if (isAllowedTestOrFixture(filePath)) return { imports: [], violations: [] };

  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const dangerousCalls = new Map();
  const dangerousConstructors = new Map();
  const dangerousNamespaces = new Map();
  const staticStrings = new Map();
  const imports = [];
  const violations = [];

  function addViolation(node, symbol, reason) {
    if (isInsideExplicitDevGuard(node, sourceFile)) return;
    violations.push({
      file: relative(filePath),
      line: lineOf(sourceFile, node),
      symbol,
      reason,
      category: categoryFor(filePath),
    });
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = stringValue(statement.moduleSpecifier);
    if (!specifier) continue;
    const resolved = resolveImport(filePath, specifier);
    if (resolved) imports.push(resolved);
    const kind = moduleKind(filePath, specifier);
    if (!kind || !statement.importClause) continue;

    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      dangerousNamespaces.set(bindings.name.text, kind);
    } else if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        const local = element.name.text;
        if (kind === "repo-root" && imported === "getRepo") dangerousCalls.set(local, "getRepo");
        if (kind === "repo-local" && imported === "getBoardsRepo") dangerousCalls.set(local, "getBoardsRepo");
        if (kind === "repo-local" && (imported === "LocalRepo" || imported === "LocalBoardsRepo")) {
          dangerousConstructors.set(local, imported);
        }
      }
    }
  }

  // Local factory implementations declare their own concrete class/function names.
  for (const statement of sourceFile.statements) {
    if (ts.isClassDeclaration(statement) && statement.name) {
      if (statement.name.text === "LocalRepo" || statement.name.text === "LocalBoardsRepo") {
        dangerousConstructors.set(statement.name.text, statement.name.text);
      }
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      if (statement.name.text === "getRepo" || statement.name.text === "getBoardsRepo") {
        dangerousCalls.set(statement.name.text, statement.name.text);
      }
    }
  }

  // Follow immutable aliases so a direct import cannot be hidden behind an assignment
  // or namespace destructuring before it is invoked/constructed.
  let aliasesChanged = true;
  while (aliasesChanged) {
    aliasesChanged = false;
    function aliasTarget(expression, aliases) {
      if (ts.isParenthesizedExpression(expression)) return aliasTarget(expression.expression, aliases);
      if (ts.isIdentifier(expression)) return aliases.get(expression.text) ?? null;
      if (ts.isCallExpression(expression)) {
        const invoked = expressionPath(expression.expression);
        if (invoked?.endsWith(".bind")) {
          return aliasTarget(expression.expression.expression, aliases);
        }
      }
      if (ts.isPropertyAccessExpression(expression)) {
        const direct = aliases.get(expressionPath(expression));
        if (direct) return direct;
      }
      if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
        const kind = dangerousNamespaces.get(expression.expression.text);
        const member = expression.name.text;
        if (aliases === dangerousCalls && kind === "repo-root" && member === "getRepo") return "getRepo";
        if (aliases === dangerousCalls && kind === "repo-local" && member === "getBoardsRepo") return "getBoardsRepo";
        if (
          aliases === dangerousConstructors
          && kind === "repo-local"
          && (member === "LocalRepo" || member === "LocalBoardsRepo")
        ) return member;
      }
      if (
        ts.isElementAccessExpression(expression)
        && expression.argumentExpression
      ) {
        const direct = aliases.get(expressionPath(expression));
        if (direct) return direct;
      }
      if (
        ts.isElementAccessExpression(expression)
        && ts.isIdentifier(expression.expression)
        && expression.argumentExpression
      ) {
        const member = stringValue(expression.argumentExpression);
        const kind = dangerousNamespaces.get(expression.expression.text);
        if (aliases === dangerousCalls && kind === "repo-root" && member === "getRepo") return "getRepo";
        if (aliases === dangerousCalls && kind === "repo-local" && member === "getBoardsRepo") return "getBoardsRepo";
        if (
          aliases === dangerousConstructors
          && kind === "repo-local"
          && (member === "LocalRepo" || member === "LocalBoardsRepo")
        ) return member;
      }
      if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        return aliasTarget(expression.right, aliases);
      }
      if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        return aliasTarget(expression.right, aliases);
      }
      return null;
    }
    function collectAliases(node) {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const literal = stringValue(node.initializer);
        if (ts.isIdentifier(node.name) && literal !== null && !staticStrings.has(node.name.text)) {
          staticStrings.set(node.name.text, literal);
          aliasesChanged = true;
        }
        if (ts.isIdentifier(node.name)) {
          const call = aliasTarget(node.initializer, dangerousCalls);
          const constructor = aliasTarget(node.initializer, dangerousConstructors);
          if (call && !dangerousCalls.has(node.name.text)) {
            dangerousCalls.set(node.name.text, call);
            aliasesChanged = true;
          }
          if (constructor && !dangerousConstructors.has(node.name.text)) {
            dangerousConstructors.set(node.name.text, constructor);
            aliasesChanged = true;
          }
          if (ts.isIdentifier(node.initializer)) {
            for (const [key, value] of dangerousCalls) {
              if (key.startsWith(`${node.initializer.text}.`) && !dangerousCalls.has(`${node.name.text}${key.slice(node.initializer.text.length)}`)) {
                dangerousCalls.set(`${node.name.text}${key.slice(node.initializer.text.length)}`, value);
                aliasesChanged = true;
              }
            }
            for (const [key, value] of dangerousConstructors) {
              if (key.startsWith(`${node.initializer.text}.`) && !dangerousConstructors.has(`${node.name.text}${key.slice(node.initializer.text.length)}`)) {
                dangerousConstructors.set(`${node.name.text}${key.slice(node.initializer.text.length)}`, value);
                aliasesChanged = true;
              }
            }
          }
          if (ts.isObjectLiteralExpression(node.initializer)) {
            for (const property of node.initializer.properties) {
              const member = ts.isShorthandPropertyAssignment(property)
                ? property.name.text
                : ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
                  ? property.name.text
                  : null;
              const value = ts.isShorthandPropertyAssignment(property) ? property.name
                : ts.isPropertyAssignment(property) ? property.initializer : null;
              const wrappedCall = value ? aliasTarget(value, dangerousCalls) : null;
              const wrappedConstructor = value ? aliasTarget(value, dangerousConstructors) : null;
              if (member && wrappedCall && !dangerousCalls.has(`${node.name.text}.${member}`)) {
                dangerousCalls.set(`${node.name.text}.${member}`, wrappedCall);
                aliasesChanged = true;
              }
              if (member && wrappedConstructor && !dangerousConstructors.has(`${node.name.text}.${member}`)) {
                dangerousConstructors.set(`${node.name.text}.${member}`, wrappedConstructor);
                aliasesChanged = true;
              }
            }
          }
        } else if (ts.isObjectBindingPattern(node.name) && ts.isIdentifier(node.initializer)) {
          const kind = dangerousNamespaces.get(node.initializer.text);
          for (const element of node.name.elements) {
            if (!ts.isIdentifier(element.name)) continue;
            const imported = element.propertyName && ts.isIdentifier(element.propertyName)
              ? element.propertyName.text
              : element.name.text;
            const wrappedCall = dangerousCalls.get(`${node.initializer.text}.${imported}`);
            const wrappedConstructor = dangerousConstructors.get(`${node.initializer.text}.${imported}`);
            if (wrappedCall && !dangerousCalls.has(element.name.text)) {
              dangerousCalls.set(element.name.text, wrappedCall);
              aliasesChanged = true;
            }
            if (wrappedConstructor && !dangerousConstructors.has(element.name.text)) {
              dangerousConstructors.set(element.name.text, wrappedConstructor);
              aliasesChanged = true;
            }
            if (kind === "repo-root" && imported === "getRepo" && !dangerousCalls.has(element.name.text)) {
              dangerousCalls.set(element.name.text, "getRepo");
              aliasesChanged = true;
            }
            if (kind === "repo-local" && imported === "getBoardsRepo" && !dangerousCalls.has(element.name.text)) {
              dangerousCalls.set(element.name.text, "getBoardsRepo");
              aliasesChanged = true;
            }
            if (
              kind === "repo-local"
              && (imported === "LocalRepo" || imported === "LocalBoardsRepo")
              && !dangerousConstructors.has(element.name.text)
            ) {
              dangerousConstructors.set(element.name.text, imported);
              aliasesChanged = true;
            }
          }
        }
      } else if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(node.left)
      ) {
        const call = aliasTarget(node.right, dangerousCalls);
        const constructor = aliasTarget(node.right, dangerousConstructors);
        if (call && !dangerousCalls.has(node.left.text)) {
          dangerousCalls.set(node.left.text, call);
          aliasesChanged = true;
        }
        if (constructor && !dangerousConstructors.has(node.left.text)) {
          dangerousConstructors.set(node.left.text, constructor);
          aliasesChanged = true;
        }
        const literal = stringValue(node.right) ?? (ts.isIdentifier(node.right) ? staticStrings.get(node.right.text) : null);
        if (literal !== null && literal !== undefined && !staticStrings.has(node.left.text)) {
          staticStrings.set(node.left.text, literal);
          aliasesChanged = true;
        }
      } else if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isObjectLiteralExpression(node.left)
        && ts.isIdentifier(node.right)
        && dangerousNamespaces.has(node.right.text)
      ) {
        const kind = dangerousNamespaces.get(node.right.text);
        for (const property of node.left.properties) {
          if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name) || !ts.isIdentifier(property.initializer)) continue;
          const imported = property.name.text;
          const local = property.initializer.text;
          if (kind === "repo-root" && imported === "getRepo" && !dangerousCalls.has(local)) {
            dangerousCalls.set(local, "getRepo");
            aliasesChanged = true;
          }
          if (kind === "repo-local" && imported === "getBoardsRepo" && !dangerousCalls.has(local)) {
            dangerousCalls.set(local, "getBoardsRepo");
            aliasesChanged = true;
          }
        }
      }
      ts.forEachChild(node, collectAliases);
    }
    collectAliases(sourceFile);
  }

  function staticString(expression) {
    const literal = stringValue(expression);
    if (literal !== null) return literal;
    if (ts.isIdentifier(expression)) return staticStrings.get(expression.text) ?? null;
    if (ts.isParenthesizedExpression(expression)) return staticString(expression.expression);
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = staticString(expression.left);
      const right = staticString(expression.right);
      return left !== null && right !== null ? left + right : null;
    }
    return null;
  }

  function visit(node) {
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments.length === 1 ? node.arguments[0] : null;
        const literal = argument ? staticString(argument) : null;
        const computed = argument && literal === null ? argument.getText() : null;
        const specifier = literal && moduleKind(filePath, literal)
          ? literal
          : computed && /(?:@\/|app\/src\/|\.\.\/|\.\/)lib\/repo(?:\/|["'`}])/.test(computed)
            ? computed
            : null;
        if (specifier) {
          addViolation(node, `import(${JSON.stringify(specifier)})`, "dynamic-local-repo-import");
        }
      } else {
        const name = callName(node);
        if (name && dangerousCalls.has(name)) {
          addViolation(node, dangerousCalls.get(name), "local-repo-factory-call");
        } else if (name?.includes(".")) {
          const [namespace, member] = name.split(".");
          const kind = dangerousNamespaces.get(namespace);
          if (kind === "repo-root" && member === "getRepo") addViolation(node, "getRepo", "namespace-alias-call");
          if (kind === "repo-local" && member === "getBoardsRepo") addViolation(node, "getBoardsRepo", "namespace-alias-call");
        }

        if (ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments.length === 1) {
          const argument = node.arguments[0];
          const specifier = staticString(argument);
          if (specifier && moduleKind(filePath, specifier)) {
            addViolation(node, `require(${JSON.stringify(specifier)})`, "dynamic-local-repo-require");
          }
        }
      }
    } else if (ts.isNewExpression(node)) {
      const name = constructorName(node);
      if (name && dangerousConstructors.has(name)) {
        addViolation(node, dangerousConstructors.get(name), "local-repo-construction");
      } else if (name?.includes(".")) {
        const [namespace, member] = name.split(".");
        if (dangerousNamespaces.get(namespace) === "repo-local" && (member === "LocalRepo" || member === "LocalBoardsRepo")) {
          addViolation(node, member, "namespace-alias-construction");
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { imports, violations };
}

function shortestEntrypointChains(files, importGraph) {
  const chains = new Map();
  const queue = files
    .filter((file) => ENTRYPOINT_PATH.test(`/${relative(file)}`))
    .map((file) => [file, [file]]);
  for (const [file, chain] of queue) chains.set(file, chain);
  while (queue.length > 0) {
    const [current, chain] = queue.shift();
    for (const imported of importGraph.get(current) ?? []) {
      if (chains.has(imported)) continue;
      const next = [...chain, imported];
      chains.set(imported, next);
      queue.push([imported, next]);
    }
  }
  return chains;
}

export function auditTree(root = APP_SOURCE_ROOT) {
  const files = collectSourceFiles(root);
  const importGraph = new Map();
  const violations = [];
  for (const file of files) {
    const analysis = analyzeSource(readFileSync(file, "utf8"), file);
    importGraph.set(file, analysis.imports);
    violations.push(...analysis.violations);
  }
  const chains = shortestEntrypointChains(files, importGraph);
  return violations.map((violation) => {
    const absolute = path.join(REPO_ROOT, violation.file);
    const chain = chains.get(absolute)?.map(relative) ?? [];
    return { ...violation, chain };
  });
}

function printAudit(violations) {
  const byCategory = new Map();
  for (const item of violations) {
    const group = byCategory.get(item.category) ?? [];
    group.push(item);
    byCategory.set(item.category, group);
  }
  console.log(`production LocalRepo/getRepo violations: ${violations.length} in ${new Set(violations.map((item) => item.file)).size} files`);
  for (const category of ["entrypoint", "service-composition", "repo-factory"]) {
    console.log(`- ${category}: ${(byCategory.get(category) ?? []).length}`);
  }
  for (const item of violations) {
    const chain = item.chain.length > 1 ? ` | chain ${item.chain.join(" -> ")}` : "";
    console.log(`${item.file}:${item.line} [${item.category}] ${item.symbol} (${item.reason})${chain}`);
  }
}

function policyKey(item) {
  return `${item.file}\u0000${item.symbol}\u0000${item.reason}`;
}

export function evaluatePolicy(violations, baseline, today = new Date().toISOString().slice(0, 10)) {
  const errors = [];
  if (baseline.version !== 1) errors.push(`invalid baseline version: ${baseline.version}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseline.capturedAt) || Number.isNaN(Date.parse(`${baseline.capturedAt}T00:00:00Z`))) {
    errors.push(`invalid baseline capturedAt: ${baseline.capturedAt}`);
  }
  if (!/^[0-9a-f]{40}$/.test(baseline.baseSha ?? "")) errors.push(`invalid baseline baseSha: ${baseline.baseSha}`);
  const counts = new Map();
  for (const violation of violations) counts.set(policyKey(violation), (counts.get(policyKey(violation)) ?? 0) + 1);

  const strictPaths = new Set(baseline.strictZeroPaths);
  for (const violation of violations) {
    if (strictPaths.has(violation.file)) {
      errors.push(`strict-zero violation: ${violation.file}:${violation.line} ${violation.symbol}`);
    }
  }

  const entries = new Map();
  for (const entry of baseline.entries) {
    const key = policyKey(entry);
    if (entries.has(key)) errors.push(`duplicate baseline entry: ${entry.file} ${entry.symbol}`);
    const validExpiry = /^\d{4}-\d{2}-\d{2}$/.test(entry.expiresOn)
      && !Number.isNaN(Date.parse(`${entry.expiresOn}T00:00:00Z`));
    if (!/^BBE-\d+ owner$/.test(entry.owner) || !/^BBE-\d+$/.test(entry.followUp) || !validExpiry) {
      errors.push(`invalid baseline metadata: ${entry.file} ${entry.symbol}`);
    }
    if (strictPaths.has(entry.file)) errors.push(`strict-zero path cannot be allowlisted: ${entry.file}`);
    entries.set(key, entry);
  }

  for (const [key, count] of counts) {
    const sample = violations.find((item) => policyKey(item) === key);
    if (strictPaths.has(sample.file)) continue;
    const entry = entries.get(key);
    if (!entry) {
      errors.push(`new violation is not baselined: ${sample.file}:${sample.line} ${sample.symbol}`);
      continue;
    }
    if (count > entry.maxCount) {
      errors.push(`violation count grew: ${sample.file} ${sample.symbol} ${entry.maxCount} -> ${count}`);
    }
  }

  for (const entry of baseline.entries) {
    const count = counts.get(policyKey(entry)) ?? 0;
    if (count < entry.maxCount) {
      errors.push(`baseline must shrink: ${entry.file} ${entry.symbol} ${entry.maxCount} -> ${count}`);
    }
    if (count > 0 && today > entry.expiresOn) {
      errors.push(`baseline expired ${entry.expiresOn}: ${entry.file} ${entry.symbol} (${entry.followUp})`);
    }
  }

  return {
    errors,
    baselineMaximum: baseline.entries.reduce((sum, entry) => sum + entry.maxCount, 0),
    baselinedCurrent: baseline.entries.reduce((sum, entry) => sum + Math.min(counts.get(policyKey(entry)) ?? 0, entry.maxCount), 0),
    strictCurrent: violations.filter((item) => strictPaths.has(item.file)).length,
  };
}

function runSelfTest() {
  const fixtureRoot = path.join(REPO_ROOT, "app", "src", "lib", "example");
  const cases = [
    {
      name: "named import alias and DI default",
      source: 'import { getRepo as localStore } from "@/lib/repo";\nexport class S { constructor(repo = localStore()) {} }',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "namespace constructor alias",
      source: 'import * as local from "@/lib/repo/local/localRepo";\nexport const store = new local.LocalRepo();',
      count: 1,
      symbols: ["LocalRepo"],
    },
    {
      name: "dynamic import",
      source: 'export async function load() { return import("@/lib/repo/local/boardsRepo"); }',
      count: 1,
      symbols: ['import("@/lib/repo/local/boardsRepo")'],
    },
    {
      name: "computed dynamic import",
      source: 'export async function load(kind) { return import(`@/lib/repo/local/${kind}`); }',
      count: 1,
      symbols: ['import("`@/lib/repo/local/${kind}`")'],
    },
    {
      name: "explicit development fixture guard",
      source: 'import { getRepo } from "@/lib/repo";\nexport const users = devToolsEnabled ? getRepo().listUsers() : [];',
      count: 0,
      symbols: [],
    },
    {
      name: "process NODE_ENV development guard",
      source: 'import { getRepo } from "@/lib/repo";\nif (process.env.NODE_ENV === "development") getRepo();',
      count: 0,
      symbols: [],
    },
    {
      name: "local NODE_ENV name cannot suppress",
      source: 'import { getRepo } from "@/lib/repo";\nconst NODE_ENV = "development"; if (NODE_ENV === "development") getRepo();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "unrelated NODE_ENV property cannot suppress",
      source: 'import { getRepo } from "@/lib/repo";\nconst config = { NODE_ENV: "development" }; if (config.NODE_ENV === "development") getRepo();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "shadowed process NODE_ENV cannot suppress",
      source: 'import { getRepo } from "@/lib/repo";\nconst process = { env: { NODE_ENV: "development" } }; if (process.env.NODE_ENV === "development") getRepo();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "destructured process NODE_ENV cannot suppress",
      source: 'import { getRepo } from "@/lib/repo";\nconst { process } = config; if (process.env.NODE_ENV === "development") getRepo();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "parameter destructured process cannot suppress",
      source: 'import { getRepo } from "@/lib/repo";\nfunction f({ process }) { if (process.env.NODE_ENV === "development") getRepo(); }',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "factory call method invocation",
      source: 'import { getRepo } from "@/lib/repo";\ngetRepo.call(null); getRepo.apply(null, []);',
      count: 2,
      symbols: ["getRepo", "getRepo"],
    },
    {
      name: "factory object wrapper invocation",
      source: 'import { getRepo } from "@/lib/repo";\nconst factories = { getRepo }; factories.getRepo();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "factory comma invocation",
      source: 'import { getRepo } from "@/lib/repo";\n(0, getRepo)();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "bound factory invocation",
      source: 'import { getRepo } from "@/lib/repo";\nconst factory = getRepo.bind(null); factory();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "wrapped factory destructuring",
      source: 'import { getRepo } from "@/lib/repo";\nconst box = { getRepo }; const { getRepo: factory } = box; factory();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "wrapped factory object alias",
      source: 'import { getRepo } from "@/lib/repo";\nconst box = { getRepo }; const other = box; other.getRepo();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "negated development guard is production",
      source: 'import { getRepo } from "@/lib/repo";\nif (!devToolsEnabled) getRepo();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "parenthesized negated development guard is production",
      source: 'import { getRepo } from "@/lib/repo";\nif ((!devToolsEnabled)) getRepo();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "false comparison development guard is production",
      source: 'import { getRepo } from "@/lib/repo";\nif (false === devToolsEnabled) getRepo();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "mixed production or development guard is production",
      source: 'import { getRepo } from "@/lib/repo";\nif (devToolsEnabled || isProduction) getRepo();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "assigned factory alias",
      source: 'import { getRepo } from "@/lib/repo";\nconst factory = getRepo; factory();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "namespace destructured factory alias",
      source: 'import * as repo from "@/lib/repo";\nconst { getRepo: factory } = repo; factory();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "factory assignment alias",
      source: 'import { getRepo } from "@/lib/repo";\nlet factory; factory = getRepo; factory();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "chained factory assignment alias",
      source: 'import { getRepo } from "@/lib/repo";\nlet first, second; first = second = getRepo; first();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "constructor assignment alias",
      source: 'import { LocalRepo } from "@/lib/repo/local/localRepo";\nlet Store; Store = LocalRepo; new Store();',
      count: 1,
      symbols: ["LocalRepo"],
    },
    {
      name: "namespace property factory alias",
      source: 'import * as repo from "@/lib/repo";\nconst factory = repo.getRepo; factory();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "namespace destructuring assignment alias",
      source: 'import * as repo from "@/lib/repo";\nlet factory; ({ getRepo: factory } = repo); factory();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "dynamic import through constant",
      source: 'const target = "@/lib/repo/local/boardsRepo";\nexport async function load() { return import(target); }',
      count: 1,
      symbols: ['import("@/lib/repo/local/boardsRepo")'],
    },
    {
      name: "local development name cannot suppress",
      source: 'import { getRepo } from "@/lib/repo";\nconst devToolsEnabled = true; if (devToolsEnabled) getRepo();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "local development function cannot suppress",
      source: 'import { getRepo } from "@/lib/repo";\nfunction devToolsEnabled() { return true; } if (devToolsEnabled()) getRepo();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "namespace bracket factory alias",
      source: 'import * as repo from "@/lib/repo";\nconst factory = repo["getRepo"]; factory();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "parenthesized namespace constructor",
      source: 'import * as local from "@/lib/repo/local/localRepo";\nnew (local.LocalRepo)();',
      count: 1,
      symbols: ["LocalRepo"],
    },
    {
      name: "namespace bracket direct call",
      source: 'import * as repo from "@/lib/repo";\nrepo["getRepo"]();',
      count: 1,
      symbols: ["getRepo"],
    },
    {
      name: "namespace bracket direct constructor",
      source: 'import * as local from "@/lib/repo/local/localRepo";\nnew local["LocalRepo"]();',
      count: 1,
      symbols: ["LocalRepo"],
    },
    {
      name: "dynamic import through constant concatenation",
      source: 'const base = "@/lib/repo/";\nexport async function load() { return import(base + "local/boardsRepo"); }',
      count: 1,
      symbols: ['import("@/lib/repo/local/boardsRepo")'],
    },
    {
      name: "safe injected port",
      source: 'export function run(repo) { return repo.listDeals(); }',
      count: 0,
      symbols: [],
    },
  ];
  for (const item of cases) {
    const result = analyzeSource(item.source, path.join(fixtureRoot, `${item.name.replaceAll(" ", "-")}.ts`));
    assert.equal(result.violations.length, item.count, item.name);
    assert.deepEqual(result.violations.map((violation) => violation.symbol), item.symbols, item.name);
  }
  const excluded = analyzeSource(
    'import { getRepo } from "@/lib/repo"; getRepo();',
    path.join(APP_SOURCE_ROOT, "lib", "example.test.ts"),
  );
  assert.equal(excluded.violations.length, 0, "test files are explicit injection boundaries");
  const policyFixture = {
    version: 1,
    capturedAt: "2099-01-01",
    baseSha: "a".repeat(40),
    strictZeroPaths: ["app/src/app/(app)/page.tsx"],
    entries: [{
      file: "app/src/lib/legacy.ts",
      symbol: "getRepo",
      reason: "local-repo-factory-call",
      maxCount: 2,
      owner: "BBE-15 owner",
      followUp: "BBE-15",
      expiresOn: "2099-12-31",
    }],
  };
  const legacy = { file: "app/src/lib/legacy.ts", line: 1, symbol: "getRepo", reason: "local-repo-factory-call" };
  assert.match(evaluatePolicy([legacy], policyFixture).errors[0], /must shrink/, "baseline shrink must be captured");
  assert.equal(evaluatePolicy([legacy, legacy], policyFixture).errors.length, 0, "exact baseline remains valid");
  assert.match(evaluatePolicy([legacy, legacy, legacy], policyFixture).errors[0], /grew/, "baseline may not grow");
  assert.match(
    evaluatePolicy([{ ...legacy, file: "app/src/app/(app)/page.tsx" }], policyFixture).errors[0],
    /strict-zero/,
    "strict scope is never allowlisted",
  );
  assert.match(evaluatePolicy([legacy, legacy], policyFixture, "2100-01-01").errors[0], /expired/, "baseline expires");
  console.log(`production repo boundary self-test: ${cases.length + 5} passed`);
}

const args = new Set(process.argv.slice(2));
if (args.has("--self-test")) {
  runSelfTest();
} else {
  const violations = auditTree();
  printAudit(violations);
  if (!args.has("--audit")) {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    const baselineMaximum = baseline.entries?.reduce((sum, entry) => sum + entry.maxCount, 0);
    if (baselineMaximum !== BASELINE_CEILING) {
      console.error(`ERROR baseline ceiling must remain ${BASELINE_CEILING}, received ${baselineMaximum}`);
      process.exitCode = 1;
    }
    const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim() === "true";
    if (shallow) {
      console.log("boundary ratchet: shallow checkout; baseline ancestry verification deferred");
    } else {
      try {
        execFileSync("git", ["cat-file", "-e", `${baseline.baseSha}^{commit}`], { cwd: REPO_ROOT, stdio: "ignore" });
        execFileSync("git", ["merge-base", "--is-ancestor", baseline.baseSha, "HEAD"], { cwd: REPO_ROOT, stdio: "ignore" });
      } catch {
        console.error(`ERROR baseline baseSha is not a commit ancestor of HEAD: ${baseline.baseSha}`);
        process.exitCode = 1;
      }
    }
    const policy = evaluatePolicy(violations, baseline);
    console.log(`boundary ratchet: baseline ${policy.baselinedCurrent}/${policy.baselineMaximum}, strict ${policy.strictCurrent}`);
    for (const error of policy.errors) console.error(`ERROR ${error}`);
    if (policy.errors.length > 0) process.exitCode = 1;
  }
}
