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

/** 목업 탭과 앱의 구조 팩 보드 slug. 공지사항은 현재 팩이 없어 목업 전용 차이로 남긴다. */
const PACK_BY_TAB = { new: "newcust", contact: "contact", work: "work" };

const APP_TYPE_TO_MOCKUP_TYPES = {
  text: ["text"],
  longtext: ["text"],
  number: ["num", "money"],
  date: ["date"],
  datetime: ["dt"],
  phone: ["phone"],
  email: ["email"],
  checkbox: ["check"],
  select: ["sel", "status"],
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
      if (!specifier.startsWith(".")) throw new Error(`지원하지 않는 구조 팩 import: ${specifier}`);
      const candidate = path.resolve(path.dirname(absolute), specifier);
      const resolved = fs.existsSync(candidate) ? candidate : `${candidate}.ts`;
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

function appOptionLabels(column, optionSets) {
  const options = column.options ?? optionSets[column.optionRef] ?? [];
  return options.map((option) => option.label);
}

function isPersonalChoice(column) {
  return /담당자|협업자/.test(column.label) || ["person", "people"].includes(column.type);
}

function optionsForReport(column, values) {
  if (isPersonalChoice(column)) return values.length ? `${values.length}개(개인 선택지 숨김)` : "없음";
  return values.join(", ") || "없음";
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

function compareTab(mockTab, packBoard, optionSets) {
  console.log(`\n▣ ${mockTab.label} (${mockTab.key}) ↔ ${packBoard ? packBoard.name : "앱 팩 없음"}`);
  if (!packBoard) return difference("앱 팩 없음", [`목업 탭 ${mockTab.key}`]);

  let differences = 0;
  const mockColumns = new Map(mockTab.columns.map((column) => [column.label, column]));
  const appColumns = new Map(packBoard.columns.map((column) => [column.label, column]));
  differences += list("목업에만 있는 컬럼", [...mockColumns.keys()].filter((label) => !appColumns.has(label)));
  differences += list("앱에만 있는 컬럼", [...appColumns.keys()].filter((label) => !mockColumns.has(label)));

  const typeDifferences = [];
  const sourceDifferences = [];
  const optionDifferences = [];
  for (const [label, mockColumn] of mockColumns) {
    const appColumn = appColumns.get(label);
    if (!appColumn) continue;
    const accepted = APP_TYPE_TO_MOCKUP_TYPES[appColumn.type] ?? [];
    if (mockColumn.type && !accepted.includes(mockColumn.type)) {
      typeDifferences.push(`${label}: 목업 ${mockColumn.type} → 앱 ${appColumn.type}`);
    }
    // 구조 팩에는 목업의 값 출처(in/auto/act 등)를 기록하는 필드가 없다. 빈 값으로 맞추지 않고 차이로 남긴다.
    if (mockColumn.source) sourceDifferences.push(`${label}: 목업 ${mockColumn.source} → 앱 출처 정의 없음`);

    const mockOptions = [...mockColumn.options];
    const appOptions = appOptionLabels(appColumn, optionSets);
    const mockOnly = mockOptions.filter((value) => !appOptions.includes(value));
    const appOnly = appOptions.filter((value) => !mockOptions.includes(value));
    if (mockOnly.length || appOnly.length) {
      optionDifferences.push(`${label}: 목업만 [${optionsForReport(mockColumn, mockOnly)}] / 앱만 [${optionsForReport(appColumn, appOnly)}]`);
    }
  }
  differences += difference("타입 차이", typeDifferences);
  differences += difference("출처 차이", sourceDifferences);
  differences += difference("선택지 차이", optionDifferences);

  // 그룹명에는 담당자 예시가 섞일 수 있으므로 값은 출력하지 않고, 순서와 구조만 대조한다.
  const mockGroups = mockTab.groups;
  const appGroups = packBoard.sections.map((section) => section.groupName);
  const groupDifferences = mockGroups.length === appGroups.length ? [] : [`그룹 수: 목업 ${mockGroups.length}개 → 앱 ${appGroups.length}개`];
  for (let index = 0; index < Math.max(mockGroups.length, appGroups.length); index += 1) {
    if (mockGroups[index] !== appGroups[index]) {
      groupDifferences.push(`그룹 #${index + 1}: 이름·순서 또는 존재 여부 불일치 (값 숨김)`);
    }
  }
  differences += difference("그룹 구조 차이", groupDifferences);

  // 구조 팩은 자동 이동 규칙을 아직 표현하지 않는다. 각 규칙은 이름이 아닌 필드·값·대상 그룹 인덱스로 남긴다.
  if (mockTab.moves.length) {
    const moveEntries = mockTab.moves.map((move, index) => {
      const column = mockColumns.get(move.column);
      const value = column && isPersonalChoice(column) ? "개인 선택지 숨김" : move.value;
      return `${index + 1}. ${move.column}=${value} → 목업 그룹 #${mockTab.groups.indexOf(move.group) + 1}; 앱 정의 없음`;
    });
    differences += difference("자동 이동 규칙 차이", moveEntries);
  }
  if (mockTab.transitions.length) {
    const transitionEntries = mockTab.transitions.map((transition, index) => {
      const guard = transition.guard ? `; 잠금 ${transition.guard.column}=${transition.guard.value}` : "";
      return `${index + 1}. ${transition.column}=${transition.value} → 목업 탭 ${transition.to}${guard}; 앱 정의 없음`;
    });
    differences += difference("탭 간 이동 관문 차이", transitionEntries);
  }
  if (mockTab.nav) {
    differences += difference("탭 위치 차이", [`목업 ${mockTab.nav.kind} 탐색에 있음; 앱 구조 팩 탐색 정의 없음`]);
  }
  return differences;
}

function main() {
  const mockup = extractMockupContract();
  const { SEOUL_STRUCTURE_PACK } = loadTypeScriptModule(packEntry);
  if (!SEOUL_STRUCTURE_PACK?.boards || !SEOUL_STRUCTURE_PACK?.optionSets) {
    throw new Error("구조 팩을 읽지 못했습니다: SEOUL_STRUCTURE_PACK 계약이 없습니다.");
  }

  console.log("═".repeat(72));
  console.log("모아워크 앱 ↔ 목업 구조 대조 (BBE-140 · 보고 전용)");
  console.log("목업이 정본입니다. 이 출력은 앱이나 목업을 고치지 않습니다.");
  console.log("═".repeat(72));

  let differences = 0;
  const consumedSlugs = new Set();
  for (const mockTab of mockup.tabs) {
    const slug = PACK_BY_TAB[mockTab.key];
    const board = slug ? SEOUL_STRUCTURE_PACK.boards.find((candidate) => candidate.slug === slug) : null;
    if (slug) consumedSlugs.add(slug);
    differences += compareTab(mockTab, board, SEOUL_STRUCTURE_PACK.optionSets);
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
  console.log("qa-app 누락 회귀 2 / 2 통과");
}

try {
  if (process.argv[2] === "--self-test") runRegressions();
  else main();
} catch (error) {
  console.error(`qa-app 실행 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
