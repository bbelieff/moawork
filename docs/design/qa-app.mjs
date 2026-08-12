/*
 * 앱 구조 팩과 목업 정본의 차이를 재는 0번 관문(BBE-140).
 *
 * 이 스크립트는 앱이나 목업을 고치지 않는다. 목업에서 추출한 구조와 구조 팩의 실제 정의를
 * 나란히 읽고, 조립 카드가 고칠 수 있도록 차이만 출력한다. 차이가 있으면 종료 코드 1이다.
 * `scripts/check.sh`는 1단계에서 그 코드를 보고만 하고 실패로 바꾸지 않는다.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { extractMockupContract, validateMockupContractApi } from "./dump-mockup.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "../..");
const packEntry = path.join(root, "app", "src", "lib", "structure-packs", "seoul-pack.ts");
const defaultTabEntry = path.join(root, "app", "src", "lib", "default-tabs", "new-lead.ts");
const workspaceCreateConsumer = path.join(root, "app", "src", "lib", "workspace-entry", "server.ts");
const newLeadRouteConsumer = path.join(root, "app", "src", "lib", "newcust", "entry.ts");

/** 목업 탭과 앱의 구조 팩 보드 slug. 공지사항은 현재 팩이 없어 목업 전용 차이로 남긴다. */
const PACK_BY_TAB = { new: "newcust", contact: "contact", work: "work" };

const APP_TYPE_TO_MOCKUP_TYPES = {
  text: ["text"],
  longtext: ["text"],
  number: ["num", "money"],
  money: ["money"],
  date: ["date"],
  datetime: ["dt"],
  phone: ["phone"],
  email: ["email"],
  checkbox: ["check"],
  select: ["sel", "status"],
  status: ["sel", "status"],
  multiselect: ["sel"],
  person: ["person"],
  people: ["people"],
  file: ["file"],
  url: ["link"],
};

function loadTypeScriptModule(entryPath) {
  let ts;
  try {
    ts = require("typescript");
  } catch {
    throw new Error("typescript 의존성이 없습니다. 루트에서 npm install 뒤 다시 실행하세요.");
  }

  const cache = new Map();
  function load(filePath) {
    const absolute = path.resolve(filePath);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const source = fs.readFileSync(absolute, "utf8");
    const module = { exports: {} };
    cache.set(absolute, module);
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: absolute,
    }).outputText;
    const localRequire = (specifier) => {
      const candidate = specifier.startsWith("@/")
        ? path.join(root, "app", "src", specifier.slice(2))
        : specifier.startsWith(".")
          ? path.resolve(path.dirname(absolute), specifier)
          : null;
      if (!candidate) throw new Error(`지원하지 않는 앱 계약 import: ${specifier}`);
      const resolved = [candidate, `${candidate}.ts`, `${candidate}.tsx`, path.join(candidate, "index.ts")]
        .find((pathCandidate) => fs.existsSync(pathCandidate));
      if (!resolved) throw new Error(`앱 계약 import를 찾지 못했습니다: ${specifier}`);
      return load(resolved);
    };
    new Function("exports", "module", "require", "__filename", "__dirname", compiled)(
      module.exports,
      module,
      localRequire,
      absolute,
      path.dirname(absolute),
    );
    return module.exports;
  }
  return load(entryPath);
}

function validateDefaultTab(tab) {
  if (!tab || typeof tab !== "object") throw new Error("기본 탭 계약이 객체가 아닙니다.");
  if (tab.key !== "new") throw new Error(`지원하지 않는 기본 탭 key: ${String(tab.key)}`);
  if (!Array.isArray(tab.groups) || !tab.groups.length) throw new Error("기본 탭 그룹 계약이 없습니다.");
  if (!Array.isArray(tab.columns) || !tab.columns.length) throw new Error("기본 탭 컬럼 계약이 없습니다.");
  if (!Array.isArray(tab.transitions)) throw new Error("기본 탭 전환 계약이 배열이 아닙니다.");

  const groupNames = new Set();
  for (const group of tab.groups) {
    if (!group || typeof group.name !== "string" || !group.name) throw new Error("기본 탭 그룹 이름이 없습니다.");
    if (groupNames.has(group.name)) throw new Error(`기본 탭 그룹 이름이 중복됩니다: ${group.name}`);
    groupNames.add(group.name);
  }

  const columnKeys = new Set();
  const columnLabels = new Set();
  for (const column of tab.columns) {
    if (!column || typeof column.key !== "string" || !column.key) throw new Error("기본 탭 컬럼 key가 없습니다.");
    if (typeof column.label !== "string" || !column.label) throw new Error(`기본 탭 컬럼 label이 없습니다: ${column.key}`);
    if (typeof column.type !== "string" || !column.type) throw new Error(`기본 탭 컬럼 type이 없습니다: ${column.label}`);
    if (typeof column.source !== "string" || !column.source) throw new Error(`기본 탭 컬럼 source가 없습니다: ${column.label}`);
    if (column.options !== undefined && !Array.isArray(column.options)) throw new Error(`기본 탭 컬럼 options가 배열이 아닙니다: ${column.label}`);
    if (columnKeys.has(column.key)) throw new Error(`기본 탭 컬럼 key가 중복됩니다: ${column.key}`);
    if (columnLabels.has(column.label)) throw new Error(`기본 탭 컬럼 label이 중복됩니다: ${column.label}`);
    columnKeys.add(column.key);
    columnLabels.add(column.label);
    if (column.moveTo) {
      for (const target of Object.values(column.moveTo)) {
        if (!groupNames.has(target)) throw new Error(`기본 탭 이동 대상 그룹이 없습니다: ${column.label} → ${target}`);
      }
    }
  }

  for (const transition of tab.transitions) {
    if (!transition || !columnKeys.has(transition.columnKey)) {
      throw new Error(`기본 탭 전환 컬럼이 없습니다: ${String(transition?.columnKey)}`);
    }
    if (typeof transition.value !== "string" || !transition.value || typeof transition.to !== "string" || !transition.to) {
      throw new Error(`기본 탭 전환 계약이 불완전합니다: ${transition.columnKey}`);
    }
  }
}

function normalizeDefaultTab(tab) {
  validateDefaultTab(tab);
  const columnsByKey = new Map(tab.columns.map((column) => [column.key, column]));
  for (const transition of tab.transitions) {
    if (transition.guard && !columnsByKey.has(transition.guard.columnKey)) {
      throw new Error(`기본 탭 전환 잠금 컬럼이 없습니다: ${String(transition.guard.columnKey)}`);
    }
  }
  return {
    name: `기본 탭 ${tab.icon} ${tab.name}`,
    columns: tab.columns,
    sections: tab.groups.map((group) => ({ groupName: group.name })),
    moves: tab.columns.flatMap((column) => Object.entries(column.moveTo ?? {}).map(([value, group]) => ({
      column: column.label,
      value,
      group,
    }))),
    transitions: tab.transitions.map((transition) => ({
      column: columnsByKey.get(transition.columnKey).label,
      value: transition.value,
      to: transition.to,
      guard: transition.guard
        ? { column: columnsByKey.get(transition.guard.columnKey)?.label, value: transition.guard.value }
        : null,
    })),
  };
}

function appOptionLabels(column, optionSets) {
  const options = column.options ?? optionSets[column.optionRef] ?? [];
  return options.map((option) => option.label);
}

function isPersonalChoice(column) {
  return /담당자|협업자/.test(column.label) || ["person", "people"].includes(column.type);
}

function optionsForReport(column, values) {
  if (isPersonalChoice(column)) return values.length ? `${values.length}개(개인 선택지 숨김)` : "없음";
  if (!values.length) return "없음";
  return values.map((value) => value === "" ? "(빈값)" : value).join(", ");
}

function acceptsMockupType(appType, mockType) {
  return (APP_TYPE_TO_MOCKUP_TYPES[appType] ?? []).includes(mockType);
}

function messageSafetyDifference(label, mockColumn, appColumn) {
  if (mockColumn.source !== "msg" || appColumn.source !== "msg") return null;
  if (appColumn.readOnly === true && typeof appColumn.pendingReason === "string" && appColumn.pendingReason.trim()) {
    return null;
  }
  return `${label}: 문자 발송 열은 readOnly와 pendingReason이 모두 필요합니다`;
}

function defaultTabConsumptionState(readSource = (filePath) => fs.readFileSync(filePath, "utf8")) {
  const workspaceSource = readSource(workspaceCreateConsumer);
  const newLeadSource = readSource(newLeadRouteConsumer);
  const workspaceConnected = /@\/lib\/default-tabs/.test(workspaceSource)
    && /\b(?:ensureDefaultTabs|NEW_LEAD_TAB)\b/.test(workspaceSource);
  const routeConnected = /@\/lib\/default-tabs/.test(newLeadSource)
    && /\bNEW_LEAD_TAB\b/.test(newLeadSource);
  const reasons = [];
  if (!workspaceConnected) reasons.push("새 워크스페이스 생성 서버 경로가 기본 탭 정본을 소비하지 않음");
  if (!routeConnected) reasons.push("신규리드 제품 주소가 기본 탭 정본을 소비하지 않음");
  return { connected: workspaceConnected && routeConnected, reasons };
}

function list(label, values, render = (value) => value) {
  if (!values.length) return 0;
  console.log(`  ${label} ${values.length}개: ${values.map(render).join(" · ")}`);
  return values.length;
}

function difference(title, entries) {
  if (!entries.length) return 0;
  console.log(`\n[${title}] ${entries.length}개`);
  for (const entry of entries) console.log(`  - ${entry}`);
  return entries.length;
}

function compareTab(mockTab, packBoard, optionSets = {}, emit = true) {
  const print = emit ? console.log : () => {};
  print(`\n▣ ${mockTab.label} (${mockTab.key}) ↔ ${packBoard ? packBoard.name : "앱 팩 없음"}`);
  if (!packBoard) return emit ? difference("앱 팩 없음", [`목업 탭 ${mockTab.key}`]) : 1;

  let differences = 0;
  const mockColumns = new Map(mockTab.columns.map((column) => [column.label, column]));
  const appColumns = new Map(packBoard.columns.map((column) => [column.label, column]));
  const mockOnlyColumns = [...mockColumns.keys()].filter((label) => !appColumns.has(label));
  const appOnlyColumns = [...appColumns.keys()].filter((label) => !mockColumns.has(label));
  differences += emit ? list("목업에만 있는 컬럼", mockOnlyColumns) : mockOnlyColumns.length;
  differences += emit ? list("앱에만 있는 컬럼", appOnlyColumns) : appOnlyColumns.length;

  const typeDifferences = [];
  const sourceDifferences = [];
  const optionDifferences = [];
  const safetyDifferences = [];
  for (const [label, mockColumn] of mockColumns) {
    const appColumn = appColumns.get(label);
    if (!appColumn) continue;
    if (mockColumn.type && !acceptsMockupType(appColumn.type, mockColumn.type)) {
      typeDifferences.push(`${label}: 목업 ${mockColumn.type} → 앱 ${appColumn.type}`);
    }
    if (mockColumn.source && appColumn.source !== mockColumn.source) {
      sourceDifferences.push(`${label}: 목업 ${mockColumn.source} → 앱 ${appColumn.source ?? "출처 정의 없음"}`);
    }
    const safetyDifference = messageSafetyDifference(label, mockColumn, appColumn);
    if (safetyDifference) safetyDifferences.push(safetyDifference);

    const mockOptions = [...mockColumn.options];
    const appOptions = appOptionLabels(appColumn, optionSets);
    const mockOnly = mockOptions.filter((value) => !appOptions.includes(value));
    const appOnly = appOptions.filter((value) => !mockOptions.includes(value));
    if (mockOnly.length || appOnly.length) {
      optionDifferences.push(`${label}: 목업만 [${optionsForReport(mockColumn, mockOnly)}] / 앱만 [${optionsForReport(appColumn, appOnly)}]`);
    }
  }
  differences += emit ? difference("타입 차이", typeDifferences) : typeDifferences.length;
  differences += emit ? difference("출처 차이", sourceDifferences) : sourceDifferences.length;
  differences += emit ? difference("선택지 차이", optionDifferences) : optionDifferences.length;
  differences += emit ? difference("발송 안전 차이", safetyDifferences) : safetyDifferences.length;

  // 그룹명에는 담당자 예시가 섞일 수 있으므로 값은 출력하지 않고, 순서와 구조만 대조한다.
  const mockGroups = mockTab.groups;
  const appGroups = packBoard.sections.map((section) => section.groupName);
  const groupDifferences = mockGroups.length === appGroups.length ? [] : [`그룹 수: 목업 ${mockGroups.length}개 → 앱 ${appGroups.length}개`];
  for (let index = 0; index < Math.max(mockGroups.length, appGroups.length); index += 1) {
    if (mockGroups[index] !== appGroups[index]) {
      groupDifferences.push(`그룹 #${index + 1}: 이름·순서 또는 존재 여부 불일치 (값 숨김)`);
    }
  }
  differences += emit ? difference("그룹 구조 차이", groupDifferences) : groupDifferences.length;

  const appMoves = packBoard.moves ?? [];
  if (mockTab.moves.length) {
    const moveEntries = mockTab.moves.filter((move) => !appMoves.some((candidate) => (
      candidate.column === move.column && candidate.value === move.value && candidate.group === move.group
    ))).map((move, index) => {
      const column = mockColumns.get(move.column);
      const value = column && isPersonalChoice(column) ? "개인 선택지 숨김" : move.value;
      return `${index + 1}. ${move.column}=${value} → 목업 그룹 #${mockTab.groups.indexOf(move.group) + 1}; 앱 정의 없음`;
    });
    differences += emit ? difference("자동 이동 규칙 차이", moveEntries) : moveEntries.length;
  }
  const appTransitions = packBoard.transitions ?? [];
  if (mockTab.transitions.length) {
    const transitionEntries = mockTab.transitions.filter((transition) => !appTransitions.some((candidate) => (
      candidate.column === transition.column
      && candidate.value === transition.value
      && candidate.to === transition.to
      && (candidate.guard?.column ?? null) === (transition.guard?.column ?? null)
      && (candidate.guard?.value ?? null) === (transition.guard?.value ?? null)
    ))).map((transition, index) => {
      const guard = transition.guard ? `; 잠금 ${transition.guard.column}=${transition.guard.value}` : "";
      return `${index + 1}. ${transition.column}=${transition.value} → 목업 탭 ${transition.to}${guard}; 앱 정의 없음`;
    });
    differences += emit ? difference("탭 간 이동 관문 차이", transitionEntries) : transitionEntries.length;
  }
  if (mockTab.nav) {
    const navEntries = [`목업 ${mockTab.nav.kind} 탐색에 있음; 앱 구조 팩 탐색 정의 없음`];
    differences += emit ? difference("탭 위치 차이", navEntries) : navEntries.length;
  }
  return differences;
}

function main() {
  const mockup = extractMockupContract();
  const { SEOUL_STRUCTURE_PACK } = loadTypeScriptModule(packEntry);
  const { NEW_LEAD_TAB } = loadTypeScriptModule(defaultTabEntry);
  if (!SEOUL_STRUCTURE_PACK?.boards || !SEOUL_STRUCTURE_PACK?.optionSets) {
    throw new Error("구조 팩을 읽지 못했습니다: SEOUL_STRUCTURE_PACK 계약이 없습니다.");
  }

  console.log("═".repeat(72));
  console.log("모아워크 앱 ↔ 목업 구조 대조 (BBE-140 · 보고 전용)");
  console.log("목업이 정본입니다. 이 출력은 앱이나 목업을 고치지 않습니다.");
  console.log("═".repeat(72));

  let differences = 0;
  const defaultTabs = new Map([["new", normalizeDefaultTab(NEW_LEAD_TAB)]]);
  const consumption = defaultTabConsumptionState();
  const consumedSlugs = new Set();
  for (const mockTab of mockup.tabs) {
    const slug = PACK_BY_TAB[mockTab.key];
    const legacyBoard = slug ? SEOUL_STRUCTURE_PACK.boards.find((candidate) => candidate.slug === slug) : null;
    const board = defaultTabs.get(mockTab.key) ?? legacyBoard;
    if (slug) consumedSlugs.add(slug);
    const currentDifferences = compareTab(mockTab, board, SEOUL_STRUCTURE_PACK.optionSets);
    differences += currentDifferences;
    if (mockTab.key === "new" && !consumption.connected) {
      const legacyDifferences = compareTab(mockTab, legacyBoard, SEOUL_STRUCTURE_PACK.optionSets, false);
      const heldDifferences = Math.max(0, legacyDifferences - currentDifferences);
      if (heldDifferences) {
        console.log(`\n[제품 소비 연결 HOLD] ${heldDifferences}개`);
        console.log("  - 기본 탭 정의만 확인됐으며 화면·생성 경로 연결 전에는 구현 차감하지 않습니다.");
        for (const reason of consumption.reasons) console.log(`  - ${reason}`);
        differences += heldDifferences;
      }
    }
  }

  const appOnlyBoards = SEOUL_STRUCTURE_PACK.boards.filter((board) => !consumedSlugs.has(board.slug));
  differences += list("\n목업에 대응 탭이 없는 앱 보드", appOnlyBoards.map((board) => board.slug));
  console.log(`\n차이 합계: ${differences}개`);
  console.log(differences ? "판정: DIFF (1단계 보고 전용)" : "판정: MATCH");
  process.exitCode = differences ? 1 : 0;
}

function regressionFixture() {
  const keys = ["new", "contact", "work", "notice"];
  return {
    T: Object.fromEntries(keys.map((key) => [key, { label: key, cols: ["필드"], groups: [{ n: "그룹" }] }])),
    FIELD: Object.fromEntries(keys.map((key) => [key, { 필드: ["text", "in"] }])),
    HOT: Object.fromEntries(keys.map((key) => [key, {}])),
    MOVE: Object.fromEntries(keys.map((key) => [key, {}])),
    MOVE2: {},
    PINR: Object.fromEntries(keys.map((key) => [key, "필드"])),
    NAV: [["검증", keys, { top: 1 }]],
  };
}

function expectContractError(mutator, expectedText) {
  const fixture = regressionFixture();
  mutator(fixture);
  try {
    validateMockupContractApi(fixture);
  } catch (error) {
    if (error instanceof Error && error.message.includes(expectedText)) return;
    throw error;
  }
  throw new Error(`회귀 실패: ${expectedText} 누락을 허용했습니다.`);
}

function runRegressions() {
  expectContractError((fixture) => { delete fixture.T.notice; }, "필수 탭");
  expectContractError((fixture) => { delete fixture.FIELD.new["필드"]; }, "필드 메타데이터");
  const validDefaultTab = {
    key: "new",
    groups: [{ name: "그룹" }],
    columns: [{ key: "field", label: "필드", type: "text", source: "in" }],
    transitions: [],
  };
  validateDefaultTab(validDefaultTab);
  try {
    validateDefaultTab({ ...validDefaultTab, columns: [{ key: "field", label: "필드", type: "text" }] });
    throw new Error("회귀 실패: 기본 탭 source 누락을 허용했습니다.");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("source")) throw error;
  }
  try {
    validateDefaultTab({ ...validDefaultTab, transitions: [{ columnKey: "missing", value: "이동", to: "contact" }] });
    throw new Error("회귀 실패: 기본 탭 전환 컬럼 누락을 허용했습니다.");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("전환 컬럼")) throw error;
  }
  try {
    normalizeDefaultTab({
      ...validDefaultTab,
      transitions: [{ columnKey: "field", value: "이동", to: "contact", guard: { columnKey: "missing", value: "잠금" } }],
    });
    throw new Error("회귀 실패: 기본 탭 전환 잠금 컬럼 누락을 허용했습니다.");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("잠금 컬럼")) throw error;
  }
  if (acceptsMockupType("select", "money")) {
    throw new Error("회귀 실패: 금액 필드를 일반 선택칸으로 허용했습니다.");
  }
  if (!messageSafetyDifference("문자 발송", { source: "msg" }, { type: "status", source: "msg" })) {
    throw new Error("회귀 실패: 문자 발송 열의 안전 경계를 일반 상태칸으로 허용했습니다.");
  }
  const disconnected = defaultTabConsumptionState((filePath) => (
    filePath === workspaceCreateConsumer
      ? 'import { NEW_LEAD_TAB } from "@/lib/default-tabs"; void NEW_LEAD_TAB;'
      : 'import { SEOUL_NEWCUST_BOARD } from "@/lib/structure-packs"; void SEOUL_NEWCUST_BOARD;'
  ));
  if (disconnected.connected || disconnected.reasons.length !== 1) {
    throw new Error("회귀 실패: 정의만 있고 제품 주소가 미연결인 상태를 허용했습니다.");
  }
  console.log("qa-app 누락·민감 필드·소비 연결 회귀 8 / 8 통과");
}

try {
  if (process.argv[2] === "--self-test") runRegressions();
  else main();
} catch (error) {
  console.error(`qa-app 실행 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
