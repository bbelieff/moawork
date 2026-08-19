/*
 * 목업 v6과 제품 기본 탭을 재는 0번 관문(BBE-140).
 *
 * 앱 정본은 `app/src/lib/default-tabs/**`와 셸 분류표 `app-tabs.ts`다.
 * 먼데이 이관 사전(`structure-packs`)이나 빈 배열을 대입해 차이를 줄이지 않는다.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { extractMockupContract, validateMockupContractApi } from "./dump-mockup.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const ROOT = path.resolve(import.meta.dirname, "../..");
const APP_SRC = path.join(ROOT, "app/src");
const DEFAULT_TABS_DIR = process.env.QA_APP_DEFAULT_TABS_DIR ?? path.join(APP_SRC, "lib/default-tabs");
const APP_TABS_FILE = process.env.QA_APP_APP_TABS_FILE ?? path.join(APP_SRC, "components/shell/app-tabs.ts");

// ratchet — 2026-08-19 총괄 지적: "1단계 보고 전용"이라 아무도 안 막아서 차이가 조용히
// 쌓였다(35개까지). 기존 35개는 빚으로 인정하고 통과시키되, 이 숫자를 넘기면 즉시 막는다.
// 실제로 줄이면(계약업체 실무 그룹 정리 등) 이 상수도 «반드시 같이» 낮춘다 — production
// -repo-boundary-baseline.json 의 BASELINE_CEILING 과 같은 패턴(내려가기만 하는 천장).
const REGRESSION_CEILING = 35;

const APP_TYPE_TO_MOCKUP_TYPES = {
  text: ["txt", "text"], longtext: ["txt", "text"], number: ["num", "money"],
  money: ["money"], percentage: ["pct"], date: ["date"], datetime: ["dt"],
  phone: ["tel", "phone"], email: ["mail", "email"], checkbox: ["chk", "check"],
  select: ["sel", "status"], status: ["sel", "status"], multiselect: ["multi", "sel"],
  person: ["user", "person"], people: ["people"], file: ["file"], url: ["link"], calc: ["calc"],
};

function resolveTsFile(specifier, parent) {
  let candidate;
  if (specifier.startsWith("@/")) candidate = path.join(APP_SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) candidate = path.resolve(path.dirname(parent), specifier);
  else return null;
  for (const name of [candidate, `${candidate}.ts`, `${candidate}.tsx`, path.join(candidate, "index.ts")]) {
    if (fs.existsSync(name) && fs.statSync(name).isFile()) return name;
  }
  throw new Error(`TypeScript import를 찾지 못했습니다: ${specifier} (${parent})`);
}

function loadTypeScriptModule(entryPath, cache = new Map()) {
  const absolute = path.resolve(entryPath);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const module = { exports: {} };
  cache.set(absolute, module);
  const source = fs.readFileSync(absolute, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: absolute,
  }).outputText;
  const localRequire = (specifier) => {
    const resolved = resolveTsFile(specifier, absolute);
    return resolved ? loadTypeScriptModule(resolved, cache) : require(specifier);
  };
  new Function("exports", "module", "require", "__filename", "__dirname", compiled)(
    module.exports, module, localRequire, absolute, path.dirname(absolute),
  );
  return module.exports;
}

function looksLikeDefaultTab(value) {
  return value && typeof value === "object" && typeof value.key === "string"
    && typeof value.name === "string" && Array.isArray(value.groups)
    && Array.isArray(value.columns) && Array.isArray(value.transitions);
}

function validateShellTabs(tabs) {
  if (!Array.isArray(tabs) || tabs.length === 0) throw new Error("앱 셸 정본 형식 오류: APP_TABS가 비었습니다");
  const seen = new Set();
  for (const [index, tab] of tabs.entries()) {
    if (!tab || typeof tab !== "object" || typeof tab.key !== "string" || !tab.key
      || typeof tab.mockupLabel !== "string" || !Array.isArray(tab.altHrefs)
      || !(typeof tab.canonicalHref === "string" || tab.canonicalHref === null)
      || tab.altHrefs.some((href) => typeof href !== "string")) {
      throw new Error(`앱 셸 정본 형식 오류: APP_TABS[${index}]`);
    }
    if (seen.has(tab.key)) throw new Error(`앱 셸 탭 key 중복: ${tab.key}`);
    seen.add(tab.key);
  }
}

function validateDefaultTab(tab, source) {
  const fail = (detail) => { throw new Error(`제품 기본 탭 형식 오류: ${source} ${detail}`); };
  if (!looksLikeDefaultTab(tab)) fail("루트");
  if (tab.groups.some((group) => !group || typeof group.name !== "string" || !group.name)) fail("groups");
  const columnKeys = new Set();
  for (const column of tab.columns) {
    if (!column || typeof column.key !== "string" || !column.key || typeof column.label !== "string" || !column.label
      || typeof column.type !== "string" || typeof column.source !== "string"
      || (column.options !== undefined && (!Array.isArray(column.options)
        || column.options.some((option) => !option || typeof option.label !== "string")))) fail("columns");
    if (columnKeys.has(column.key)) fail(`column key 중복 ${column.key}`);
    columnKeys.add(column.key);
    if (column.moveTo !== undefined && (column.moveTo === null || typeof column.moveTo !== "object"
      || Array.isArray(column.moveTo) || Object.entries(column.moveTo).some(([value, group]) => !value || typeof group !== "string"))) fail("moveTo");
  }
  for (const transition of tab.transitions) {
    if (!transition || typeof transition.columnKey !== "string" || typeof transition.value !== "string"
      || typeof transition.to !== "string" || !(transition.guard === null || (typeof transition.guard === "object"
        && typeof transition.guard.columnKey === "string" && typeof transition.guard.value === "string"))) fail("transitions");
  }
}

export function loadAppContract({ defaultTabsDir = DEFAULT_TABS_DIR, appTabsFile = APP_TABS_FILE } = {}) {
  if (!fs.existsSync(appTabsFile)) throw new Error(`앱 셸 정본 상실: ${path.relative(ROOT, appTabsFile)}`);
  const shell = loadTypeScriptModule(appTabsFile);
  validateShellTabs(shell.APP_TABS);

  const tabs = new Map();
  const defaultTabsPresent = fs.existsSync(defaultTabsDir);
  if (defaultTabsPresent) {
    const files = fs.readdirSync(defaultTabsDir)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !["index.ts", "install.ts", "types.ts", "repair-on-entry.ts"].includes(name));
    if (files.length === 0) throw new Error("제품 기본 탭 정본 형식 오류: 정의 파일이 없습니다");
    for (const file of files) {
      const exports = loadTypeScriptModule(path.join(defaultTabsDir, file));
      const candidates = Object.entries(exports).filter(([name]) => /_TAB$/.test(name));
      if (candidates.length === 0) throw new Error(`제품 기본 탭 정본 형식 오류: ${file}에 *_TAB export가 없습니다`);
      for (const [name, value] of candidates) {
        validateDefaultTab(value, `${file}:${name}`);
        if (tabs.has(value.key)) throw new Error(`제품 기본 탭 key 중복: ${value.key}`);
        tabs.set(value.key, value);
      }
    }
    if (tabs.size === 0) throw new Error("제품 기본 탭 정본 형식 오류: DefaultTab export를 찾지 못했습니다");
  }
  return { tabs, shellTabs: shell.APP_TABS, defaultTabsPresent };
}

function optionLabels(column) {
  return (column.options ?? []).map((option) => option.label);
}

function isPersonal(column) {
  return /담당자|협업자/.test(column.label) || ["person", "people"].includes(column.type);
}

function safeOptions(column, values) {
  return isPersonal(column) ? `${values.length}개(개인 선택지 숨김)` : values.join(", ") || "없음";
}

function difference(title, entries) {
  if (!entries.length) return 0;
  console.log(`\n[${title}] ${entries.length}개`);
  for (const entry of entries) console.log(`  - ${entry}`);
  return entries.length;
}

function compareTab(mockTab, appTab, shellTab) {
  console.log(`\n▣ ${mockTab.label} (${mockTab.key}) ↔ ${appTab?.name ?? "제품 기본 탭 없음"}`);
  let differences = 0;
  if (!shellTab) differences += difference("셸 탭 위치 차이", [`${mockTab.key}: APP_TABS 분류 없음`]);
  else if (shellTab.mockupLabel !== mockTab.label) {
    differences += difference("셸 탭 이름 차이", [`${mockTab.key}: 목업 ${mockTab.label} → 앱 ${shellTab.mockupLabel}`]);
  }
  if (!appTab) {
    differences += difference("제품 기본 탭 상실", [`${mockTab.key}: DefaultTab 정의 없음`]);
    differences += difference("앱에 없는 그룹", mockTab.groups.map((_, index) => `${mockTab.key} 그룹 #${index + 1} (이름은 고객 예시 보호를 위해 숨김)`));
    differences += difference("앱에 없는 컬럼", mockTab.columns.map((column) => `${mockTab.key}.${column.label} (${column.type}/${column.source})`));
    differences += difference("앱에 없는 선택지", mockTab.columns.flatMap((column) => {
      const values = column.options.filter(Boolean);
      if (!values.length) return [];
      return [`${mockTab.key}.${column.label}: ${isPersonal(column) ? `${values.length}개(개인 선택지 숨김)` : values.join(", ")}`];
    }));
    differences += difference("앱에 없는 자동 이동", mockTab.moves.map((move) => {
      const value = /담당자|협업자/.test(move.column) ? "개인 선택지 숨김" : move.value;
      return `${mockTab.key}.${move.column}=${value} → 그룹 #${mockTab.groups.indexOf(move.group) + 1}`;
    }));
    differences += difference("앱에 없는 탭 이동", mockTab.transitions.map((item) => `${mockTab.key}.${item.column}=${item.value} → ${item.to}`));
    return differences;
  }
  if (appTab.name !== mockTab.label) differences += difference("탭 이름 차이", [`목업 ${mockTab.label} → 앱 ${appTab.name}`]);

  const groupEntries = [];
  for (let i = 0; i < Math.max(mockTab.groups.length, appTab.groups.length); i += 1) {
    const actual = appTab.groups[i]?.name;
    if (mockTab.groups[i] !== actual) groupEntries.push(`#${i + 1}: 이름·순서 또는 존재 여부 불일치 (값 숨김)`);
  }
  differences += difference("그룹 차이", groupEntries);

  const mockColumns = new Map(mockTab.columns.map((column) => [column.label, column]));
  const appColumns = new Map(appTab.columns.map((column) => [column.label, column]));
  differences += difference("목업에만 있는 컬럼", [...mockColumns.keys()].filter((label) => !appColumns.has(label)));
  differences += difference("앱에만 있는 컬럼", [...appColumns.keys()].filter((label) => !mockColumns.has(label)));
  const typeEntries = [], sourceEntries = [], optionEntries = [];
  for (const [label, mockColumn] of mockColumns) {
    const column = appColumns.get(label);
    if (!column) continue;
    if (!(APP_TYPE_TO_MOCKUP_TYPES[column.type] ?? []).includes(mockColumn.type)) {
      typeEntries.push(`${label}: 목업 ${mockColumn.type} → 앱 ${column.type}`);
    }
    if (mockColumn.source !== column.source) sourceEntries.push(`${label}: 목업 ${mockColumn.source} → 앱 ${column.source ?? "없음"}`);
    const mockOptions = mockColumn.options.filter(Boolean);
    const appOptions = optionLabels(column);
    const subtract = (left, right) => {
      const remaining = [...right];
      return left.filter((value) => {
        const index = remaining.indexOf(value);
        if (index < 0) return true;
        remaining.splice(index, 1);
        return false;
      });
    };
    const mockOnly = subtract(mockOptions, appOptions);
    const appOnly = subtract(appOptions, mockOptions);
    if (mockOnly.length || appOnly.length) {
      optionEntries.push(`${label}: 목업만 [${safeOptions(mockColumn, mockOnly)}] / 앱만 [${safeOptions(column, appOnly)}]`);
    }
  }
  differences += difference("타입 차이", typeEntries);
  differences += difference("출처 차이", sourceEntries);
  differences += difference("선택지 차이", optionEntries);

  const appColumnByKey = new Map(appTab.columns.map((column) => [column.key, column]));
  const appMoves = appTab.columns.flatMap((column) => Object.entries(column.moveTo ?? {}).map(([value, group]) => ({ column: column.label, value, group })));
  const moveKey = (move) => `${move.column}\u001f${move.value}\u001f${move.group}`;
  const mockMoveKeys = new Set(mockTab.moves.map(moveKey));
  const appMoveKeys = new Set(appMoves.map(moveKey));
  differences += difference("자동 이동 규칙 차이", [
    ...mockTab.moves.filter((move) => !appMoveKeys.has(moveKey(move))).map((move) => `목업만: ${move.column}=${move.value} → ${move.group}`),
    ...appMoves.filter((move) => !mockMoveKeys.has(moveKey(move))).map((move) => `앱만: ${move.column}=${move.value} → ${move.group}`),
  ]);
  const transitionKey = (transition) => {
    const column = appColumnByKey.get(transition.columnKey)?.label ?? transition.column ?? transition.columnKey;
    const guardColumn = transition.guard ? (appColumnByKey.get(transition.guard.columnKey)?.label ?? transition.guard.column ?? transition.guard.columnKey) : "";
    return `${column}\u001f${transition.value}\u001f${transition.to}\u001f${guardColumn}\u001f${transition.guard?.value ?? ""}`;
  };
  const mockTransitions = new Set(mockTab.transitions.map(transitionKey));
  const appTransitions = new Set(appTab.transitions.map(transitionKey));
  differences += difference("탭 간 이동 관문 차이", [
    ...mockTab.transitions.filter((item) => !appTransitions.has(transitionKey(item))).map((item) => `목업만: ${item.column}=${item.value} → ${item.to}`),
    ...appTab.transitions.filter((item) => !mockTransitions.has(transitionKey(item))).map((item) => `앱만: ${appColumnByKey.get(item.columnKey)?.label ?? item.columnKey}=${item.value} → ${item.to}`),
  ]);
  return differences;
}

export function compareContracts(mockup, app) {
  let differences = 0;
  const mockKeys = new Set(mockup.tabs.map((tab) => tab.key));
  for (const mockTab of mockup.tabs) {
    differences += compareTab(mockTab, app.tabs.get(mockTab.key), app.shellTabs.find((tab) => tab.key === mockTab.key));
  }
  differences += difference("목업에 대응하지 않는 제품 기본 탭", [...app.tabs.keys()].filter((key) => !mockKeys.has(key)));
  const totals = {
    mockTabs: mockup.tabs.length,
    appDefaultTabs: app.tabs.size,
    shellTabs: app.shellTabs.length,
    mockGroups: mockup.tabs.reduce((sum, tab) => sum + tab.groups.length, 0),
    appGroups: [...app.tabs.values()].reduce((sum, tab) => sum + tab.groups.length, 0),
    mockColumns: mockup.tabs.reduce((sum, tab) => sum + tab.columns.length, 0),
    appColumns: [...app.tabs.values()].reduce((sum, tab) => sum + tab.columns.length, 0),
    mockMoves: mockup.tabs.reduce((sum, tab) => sum + tab.moves.length, 0),
    appMoves: [...app.tabs.values()].reduce((sum, tab) => sum + tab.columns.reduce((n, column) => n + Object.keys(column.moveTo ?? {}).length, 0), 0),
  };
  console.log("\n[구조 수치]");
  console.log(`  탭: 목업 ${totals.mockTabs} · 제품 기본 ${totals.appDefaultTabs} · 셸 ${totals.shellTabs}`);
  console.log(`  그룹: 목업 ${totals.mockGroups} · 앱 ${totals.appGroups}`);
  console.log(`  컬럼: 목업 ${totals.mockColumns} · 앱 ${totals.appColumns}`);
  console.log(`  자동이동: 목업 ${totals.mockMoves} · 앱 ${totals.appMoves}`);
  return { differences, totals };
}

function regressionFixture() {
  const keys = ["new", "contact", "work", "notice"];
  return {
    T: Object.fromEntries(keys.map((key) => [key, { label: key, cols: ["필드"], groups: [{ n: "그룹" }] }])),
    FIELD: Object.fromEntries(keys.map((key) => [key, { 필드: ["txt", "in"] }])),
    HOT: Object.fromEntries(keys.map((key) => [key, {}])),
    MOVE: Object.fromEntries(keys.map((key) => [key, {}])), MOVE2: {},
    PINR: Object.fromEntries(keys.map((key) => [key, "필드"])), NAV: [["검증", keys, { top: 1 }]],
  };
}

function expectContractError(mutator, expectedText) {
  const fixture = regressionFixture(); mutator(fixture);
  try { validateMockupContractApi(fixture); } catch (error) {
    if (error instanceof Error && error.message.includes(expectedText)) return;
    throw error;
  }
  throw new Error(`회귀 실패: ${expectedText} 누락을 허용했습니다.`);
}

function runRegressions() {
  expectContractError((fixture) => { delete fixture.T.notice; }, "필수 탭");
  expectContractError((fixture) => { delete fixture.FIELD.new["필드"]; }, "필드 메타데이터");
  const temp = fs.mkdtempSync(path.join(process.env.TEMP ?? process.cwd(), "qa-app-"));
  try {
    const shell = path.join(temp, "app-tabs.ts");
    fs.writeFileSync(shell, "export const APP_TABS=[];");
    let failed = false;
    try { loadAppContract({ defaultTabsDir: path.join(temp, "missing"), appTabsFile: shell }); } catch { failed = true; }
    if (!failed) throw new Error("회귀 실패: 비어 있는 APP_TABS를 허용했습니다.");
    fs.writeFileSync(shell, "export const APP_TABS=[{key:'new',mockupLabel:'신규리드 관리',canonicalHref:'/newcust',altHrefs:[]}];");
    const missing = loadAppContract({ defaultTabsDir: path.join(temp, "missing"), appTabsFile: shell });
    if (missing.defaultTabsPresent || missing.tabs.size !== 0) throw new Error("회귀 실패: 상실한 default-tabs를 실제 정의처럼 셌습니다.");
    const definitions = path.join(temp, "default-tabs");
    fs.mkdirSync(definitions);
    fs.writeFileSync(path.join(definitions, "new.ts"), "export const NEW_TAB={key:'new',name:'신규리드 관리',groups:[],columns:[],transitions:[]};");
    const loaded = loadAppContract({ defaultTabsDir: definitions, appTabsFile: shell });
    if (!loaded.defaultTabsPresent || loaded.tabs.get("new")?.name !== "신규리드 관리") {
      throw new Error("회귀 실패: 실제 DefaultTab export를 읽지 못했습니다.");
    }
    fs.writeFileSync(shell, "export const APP_TABS=[{bogus:true}];");
    failed = false;
    try { loadAppContract({ defaultTabsDir: definitions, appTabsFile: shell }); } catch { failed = true; }
    if (!failed) throw new Error("회귀 실패: 잘못된 APP_TABS 항목을 허용했습니다.");
    fs.writeFileSync(shell, "export const APP_TABS=[{key:'new',mockupLabel:'신규리드 관리',canonicalHref:'/newcust',altHrefs:[]}];");
    fs.writeFileSync(path.join(definitions, "new.ts"), "export const NEW_TAB={key:'new',name:'신규리드 관리',groups:[],columns:[{key:'x'}],transitions:[]};");
    failed = false;
    try { loadAppContract({ defaultTabsDir: definitions, appTabsFile: shell }); } catch { failed = true; }
    if (!failed) throw new Error("회귀 실패: 잘못된 DefaultTab 내부 형식을 허용했습니다.");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  console.log("qa-app 누락·대상상실·형식 회귀 7 / 7 통과");
}

function main() {
  const mockup = extractMockupContract();
  const app = loadAppContract();
  console.log("═".repeat(72));
  console.log("모아워크 앱 ↔ 목업 구조 대조 (BBE-140 · 보고 전용)");
  console.log(`앱 정본: default-tabs ${app.defaultTabsPresent ? "존재" : "상실"} · app-tabs.ts ${app.shellTabs.length}탭`);
  console.log("═".repeat(72));
  const result = compareContracts(mockup, app);
  console.log(`\n차이 합계: ${result.differences}개 (천장 ${REGRESSION_CEILING})`);
  if (result.differences > REGRESSION_CEILING) {
    console.log(`판정: REGRESSION — 목업과의 차이가 ${REGRESSION_CEILING} → ${result.differences} 로 늘었습니다.`);
    console.log("목업이 기준입니다(총괄 지시 2026-08-19). 목업을 따르도록 고치거나,");
    console.log("총괄이 직접 지시해 목업보다 우선하는 변경이라면 qa-app.mjs 의 REGRESSION_CEILING 을");
    console.log("«근거를 커밋 메시지에 적고» 올리십시오 — 조용히 늘리는 것은 금지입니다.");
    process.exitCode = 2;
    return;
  }
  if (result.differences < REGRESSION_CEILING) {
    console.log(`판정: IMPROVED — 차이가 천장(${REGRESSION_CEILING})보다 적습니다.`);
    console.log(`★ REGRESSION_CEILING 을 ${result.differences} 로 낮춰 주십시오(래칫은 내려가기만 합니다).`);
    process.exitCode = 2;
    return;
  }
  console.log(result.differences ? "판정: DIFF (천장 이내 — 기존 빚)" : "판정: MATCH");
  process.exitCode = 0;
}

try {
  if (process.argv[2] === "--self-test") runRegressions();
  else main();
} catch (error) {
  console.error(`qa-app 실행 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
