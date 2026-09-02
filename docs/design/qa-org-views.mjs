/*
 * #640/#643 — 조직관리 다섯 갈래를 «실제 프로덕션 빌드» 에서 열어 찍고, 동시에 잰다.
 * AGENTS.md §3 ⑥ 의 화면 확인 증거이자, 이슈 #640 에 적은 EVAL 의 실행본이다.
 *
 * ★ 찍기만 하면 «열었다» 밖에 증명 못 한다.
 *   실제로 이 스크립트의 첫 판에서 다섯 장이 전부 「목록」으로 찍혔다 — 개발 빌드의
 *   수화가 안 돼서 갈래 클릭이 «눌리기만» 했기 때문이다. 사진만 봤으면 그대로 완주라고
 *   적었을 것이다. 그래서 숫자를 «단언» 한다 — 틀리면 사진이 아니라 스크립트가 실패한다.
 *
 * ★ 이 스크립트가 실제로 잡은 것 (2026-08-30)
 *   ① 갈래가 안 열린 채 사진만 찍힘        ② 요약은 「조직원 4」, 표는 5행
 *   ③ 조직도의 모든 부서가 「0명」          ④ 375px 에서 갈래 글자가 「권 한」으로 접힘
 *
 * 쓰는 법 — 개발 서버로는 안 된다(수화가 안 붙는다). 프로덕션 빌드로 띄운다.
 *   npm run build --workspace app
 *   npm run start --workspace app -- --port 3996
 *   SHOT_ORIGIN=http://127.0.0.1:3996 node docs/design/qa-org-views.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "playwright-core";
import {
  VisualGateStageError,
  isChildAndPortReleased,
  verifyBuildProvenance,
  waitForVisualGate,
} from "./qa-visual-gate-completion.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const externalOrigin = process.env.SHOT_ORIGIN?.replace(/\/$/, "") ?? null;
let ORIGIN = externalOrigin ?? "";
const OUT = path.resolve(root, process.env.SHOT_OUT ?? "_shots640");
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(fs.existsSync);
if (!CHROME) throw new Error("시스템 크롬을 못 찾았습니다 — 이건 시각 게이트가 아닙니다");
fs.mkdirSync(OUT, { recursive: true });

const expectedCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const sourceDiff = execFileSync("git", ["diff", "--binary", "HEAD", "--", "app", "package.json", "package-lock.json"], {
  cwd: root,
  maxBuffer: 50 * 1024 * 1024,
});
const sourceDigest = crypto.createHash("sha256").update(expectedCommit).update("\0").update(sourceDiff).digest("hex");
const provenancePath = path.join(root, "app/.next/moawork-visual-build-provenance.json");

function artifactIdentity() {
  const buildId = fs.readFileSync(path.join(root, "app/.next/BUILD_ID"), "utf8").trim();
  const digest = crypto.createHash("sha256");
  for (const name of ["BUILD_ID", "app-path-routes-manifest.json", "build-manifest.json", "routes-manifest.json"]) {
    digest.update(name).update("\0").update(fs.readFileSync(path.join(root, "app/.next", name)));
  }
  return { buildId, artifactDigest: digest.digest("hex") };
}

function readProvenance() {
  try {
    return JSON.parse(fs.readFileSync(provenancePath, "utf8"));
  } catch {
    return null;
  }
}

function ensureLocalBuildProvenance() {
  let artifact;
  try {
    artifact = artifactIdentity();
  } catch {
    artifact = null;
  }
  const expected = artifact ? { commitSha: expectedCommit, sourceDigest, ...artifact } : null;
  const existing = readProvenance();
  if (expected && verifyBuildProvenance(existing, expected).ready) return existing;

  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm", "run", "build", "--workspace", "app"]
    : ["run", "build", "--workspace", "app"];
  execFileSync(command, args, {
    cwd: root,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: "inherit",
  });
  artifact = artifactIdentity();
  const provenance = { schemaVersion: 1, commitSha: expectedCommit, sourceDigest, ...artifact };
  fs.writeFileSync(provenancePath, `${JSON.stringify(provenance)}\n`);
  const verified = verifyBuildProvenance(provenance, { commitSha: expectedCommit, sourceDigest, ...artifact });
  if (!verified.ready) {
    throw new VisualGateStageError("infrastructure", "build-provenance", "fresh organization build provenance mismatch", verified);
  }
  return provenance;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const listener = createServer();
    listener.unref();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      const port = typeof address === "object" && address ? address.port : null;
      listener.close((error) => error ? reject(error) : port ? resolve(port) : reject(new Error("ephemeral port unavailable")));
    });
  });
}

function startServer(port) {
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm", "run", "start", "--workspace", "app", "--", "--port", String(port)]
    : ["run", "start", "--workspace", "app", "--", "--port", String(port)];
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  delete env.VERCEL_GIT_COMMIT_SHA;
  return spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
}

async function waitForServer(child, origin, provenance) {
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk; });
  child.stderr.on("data", (chunk) => { log += chunk; });
  await waitForVisualGate({
    category: "infrastructure",
    stage: "org-view-server-ready",
    timeoutMs: 90_000,
    intervalMs: 500,
    probe: async () => {
      if (child.exitCode !== null) {
        throw new VisualGateStageError("infrastructure", "org-view-server-process", `server exited with ${child.exitCode}`, { log: log.slice(-1500) });
      }
      try {
        const [response, manifest] = await Promise.all([
          fetch(`${origin}/login/visual-fixture?surface=organization-views`, { signal: AbortSignal.timeout(1500) }),
          fetch(`${origin}/_next/static/${provenance.buildId}/_buildManifest.js`, { signal: AbortSignal.timeout(1500) }),
        ]);
        const html = await response.text();
        const sha = html.match(/data-build-sha="([^"]+)"/)?.[1] ?? null;
        return { ready: response.ok && manifest.ok && sha === "local", status: response.status, manifestStatus: manifest.status, sha };
      } catch (error) {
        return { ready: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  });
}

async function stopServer(child, origin) {
  if (child.exitCode === null && process.platform === "win32" && child.pid) {
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // 이미 종료됐어도 아래의 child+port 풀림 검사가 정본이다.
    }
  } else if (child.exitCode === null) {
    child.kill("SIGTERM");
  }
  const url = new URL(origin);
  await waitForVisualGate({
    category: "infrastructure",
    stage: "org-view-process-port-cleanup",
    timeoutMs: 5_000,
    intervalMs: 100,
    probe: () => isChildAndPortReleased({ childExited: child.exitCode !== null, host: url.hostname, port: Number(url.port) }),
  });
}

// 현재 정본의 다섯 갈래를 순서까지 고정한다. 추가 갈래를 숫자만 맞춰 통과시키지 않는다.
const EXPECTED_TABS = ["자리", "목록", "조직도", "권한", "알림 규칙"];
const EXPECT = { tabs: EXPECTED_TABS.length, tableColumns: 6 };

const VIEWPORTS = [
  { id: "1440x900", width: 1440, height: 900 },
  { id: "375x812", width: 375, height: 812 },
];

const SHOTS = [
  { id: "0-seats", tab: "자리", pick: null, query: "" },
  { id: "1-list", tab: "목록", pick: null, query: "" },
  { id: "1-list-picked", tab: "목록", pick: "1팀", query: "" },
  { id: "2-chart", tab: "조직도", pick: null, query: "" },
  { id: "3-perm", tab: "권한", pick: null, query: "" },
  { id: "4-rules", tab: "알림 규칙", pick: null, query: "" },
  // 보고 예외를 «못 읽은» 상태도 눈으로 본다 — 화면이 「모름」이라고 말해야 한다.
  { id: "5-reporting-unknown", tab: "목록", pick: null, query: "&reporting=unknown" },
];

const measure = (page) =>
  page.evaluate(() => ({
    tabs: [...document.querySelectorAll('[role="tab"]')].map((el) => el.textContent?.trim()),
    tabBindings: [...document.querySelectorAll('[role="tab"]')].map((el) => ({
      id: el.id,
      controls: el.getAttribute("aria-controls"),
      selected: el.getAttribute("aria-selected") === "true",
      tabIndex: el.tabIndex,
    })),
    selectedTab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() ?? null,
    visiblePanel: (() => {
      const panel = document.querySelector('[role="tabpanel"]:not([hidden])');
      return panel ? { id: panel.id, labelledBy: panel.getAttribute("aria-labelledby") } : null;
    })(),
    panelCount: document.querySelectorAll('[role="tabpanel"]').length,
    tableHeaders: [...document.querySelectorAll("thead th")].map((el) => el.textContent?.trim()),
    memberRows: [...document.querySelectorAll("tbody tr[data-user-id]")].map((el) => el.getAttribute("data-user-id")),
    paneTitle: document.querySelector('section[aria-label="조직원"] h3')?.textContent?.trim() ?? null,
    reportsToCells: [...document.querySelectorAll("tbody tr[data-user-id] td:nth-child(4)")].map((el) => el.textContent?.trim()),
    deptButtons: document.querySelectorAll("[data-department-id]").length,
    metaLine: [...document.querySelectorAll("span")].map((el) => el.textContent?.trim()).find((t) => t?.startsWith("부서 ")) ?? null,
    // 갈래 글자가 「권 한」처럼 접히면 높이가 한 줄을 넘는다. 접힘을 «잰다».
    wrappedTabs: [...document.querySelectorAll('[role="tab"]')]
      .filter((el) => el.getBoundingClientRect().height > parseFloat(getComputedStyle(el).lineHeight) * 1.6)
      .map((el) => el.textContent?.trim()),
    // 조직도 카드의 「N명」 — 전부 0명이면 부서 인원이 안 세어지고 있다는 뜻이다.
    chartCounts: [...document.querySelectorAll("[data-department-id]")].map((el) => el.textContent?.match(/(\d+)명/)?.[1] ?? null),
    // 왼쪽 부서 트리가 말하는 «하위 포함 인원». 오른쪽 표 행수와 같아야 한다.
    treeCounts: [...document.querySelectorAll('section[aria-label="부서"] [data-department-id]')].map((el) => ({
      name: el.querySelector("span.truncate")?.textContent?.trim() ?? null,
      reach: Number(el.textContent?.match(/(\d+)\s*$/)?.[1] ?? NaN),
    })),
    tablistScrollable: (() => {
      const tablist = document.querySelector("[data-org-view-tab-scroll]");
      return tablist ? tablist.scrollWidth > tablist.clientWidth + 1 : false;
    })(),
    scrollHintVisible: (() => {
      const hint = document.querySelector("[data-org-view-scroll-hint]");
      return hint ? getComputedStyle(hint).display !== "none" && hint.getBoundingClientRect().height > 0 : false;
    })(),
    rawDepartmentIdentifierVisible: /dept:\s*[0-9a-f-]{36}/i.test(document.body.innerText)
      || /d0000000-0000-4000-8000-00000000000[1-4]/i.test(document.body.innerText),
    bodyOverflowsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));

async function verifyKeyboardNavigation(browser, vp, problems) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${ORIGIN}/login/visual-fixture?surface=organization-views`, { waitUntil: "networkidle" });
  const tabs = page.getByRole("tab");
  const tabCount = await tabs.count();
  const first = tabs.nth(0);
  const last = tabs.nth(tabCount - 1);
  const list = page.getByRole("tab", { name: "목록", exact: true });
  const chart = page.getByRole("tab", { name: "조직도", exact: true });
  let arrowReady = false;
  for (let attempt = 0; attempt < 40 && !arrowReady; attempt += 1) {
    await list.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(100);
    arrowReady = (await chart.getAttribute("aria-selected")) === "true";
  }
  if (!arrowReady) problems.push(`${vp.id}/keyboard: ArrowRight가 다음 갈래를 선택하지 않았다`);
  if (await page.evaluate(() => document.activeElement?.getAttribute("data-view")) !== "chart") {
    problems.push(`${vp.id}/keyboard: ArrowRight 후 포커스가 조직도 갈래에 없다`);
  }

  await page.keyboard.press("End");
  await page.waitForTimeout(50);
  if ((await last.getAttribute("aria-selected")) !== "true") problems.push(`${vp.id}/keyboard: End가 마지막 갈래로 옮기지 않았다`);
  await page.keyboard.press("Home");
  await page.waitForTimeout(50);
  if ((await first.getAttribute("aria-selected")) !== "true" || (await first.getAttribute("data-view")) !== "seats") {
    problems.push(`${vp.id}/keyboard: Home이 첫 자리 갈래로 옮기지 않았다`);
  }
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(50);
  if ((await last.getAttribute("aria-selected")) !== "true") problems.push(`${vp.id}/keyboard: 첫 갈래의 ArrowLeft가 끝으로 순환하지 않았다`);
  if (errors.length) problems.push(`${vp.id}/keyboard console: ${errors.join(" | ")}`);
  await page.close();
}

let serverChild = null;
let browser = null;
const report = [];
const problems = [];

try {
  if (!externalOrigin) {
    const provenance = ensureLocalBuildProvenance();
    const port = await freePort();
    ORIGIN = `http://127.0.0.1:${port}`;
    serverChild = startServer(port);
    await waitForServer(serverChild, ORIGIN, provenance);
  }
  browser = await chromium.launch({ executablePath: CHROME, headless: true });

for (const vp of VIEWPORTS) {
  await verifyKeyboardNavigation(browser, vp, problems);
  for (const shot of SHOTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const pageErrors = [];
    page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${ORIGIN}/login/visual-fixture?surface=organization-views${shot.query}`, { waitUntil: "networkidle" });

    // 수화를 기다린다 — 리액트가 붙기 전에 누르면 «눌리지만» 아무 일도 안 일어난다.
    const tab = page.getByRole("tab", { name: shot.tab });
    for (let attempt = 0; attempt < 40 && (await tab.getAttribute("aria-selected")) !== "true"; attempt += 1) {
      await tab.click();
      await page.waitForTimeout(250);
    }
    if ((await tab.getAttribute("aria-selected")) !== "true") {
      problems.push(`${vp.id}/${shot.id}: 갈래 「${shot.tab}」 가 안 열렸다 — 사진을 증거로 쓸 수 없다`);
    }

    const before = await measure(page);
    if (shot.pick) {
      await page.locator("[data-department-id]").filter({ hasText: shot.pick }).first().click();
      await page.waitForTimeout(250);
    }
    const after = await measure(page);

    // ③ «부서를 고르면 오른쪽이 그 부서로 바뀐다» 를 실제로 잰다. 안 바뀌면 이어진 게 아니다.
    if (shot.pick) {
      if (after.paneTitle !== shot.pick) problems.push(`${vp.id}/${shot.id}: 부서를 골랐는데 오른쪽 제목이 «${after.paneTitle}» 다`);
      if (JSON.stringify(before.memberRows) === JSON.stringify(after.memberRows)) {
        problems.push(`${vp.id}/${shot.id}: 부서를 골라도 사람 목록이 그대로다 — 부서와 사람이 안 이어져 있다`);
      }
    }

    if (after.tabs.length !== EXPECT.tabs) problems.push(`${vp.id}/${shot.id}: 갈래가 ${after.tabs.length}개다(목표 ${EXPECT.tabs})`);
    if (JSON.stringify(after.tabs) !== JSON.stringify(EXPECTED_TABS)) {
      problems.push(`${vp.id}/${shot.id}: 갈래 순서/이름이 정본과 다르다 — ${after.tabs.join("|")}`);
    }
    if (after.panelCount !== EXPECT.tabs) problems.push(`${vp.id}/${shot.id}: tabpanel이 ${after.panelCount}개다(목표 ${EXPECT.tabs})`);
    for (const binding of after.tabBindings) {
      if (!binding.id || !binding.controls) {
        problems.push(`${vp.id}/${shot.id}: tab id/aria-controls 연결이 비어 있다`);
        break;
      }
    }
    const selectedBinding = after.tabBindings.find((binding) => binding.selected);
    if (!selectedBinding || selectedBinding.tabIndex !== 0 || after.tabBindings.filter((binding) => binding.tabIndex === 0).length !== 1) {
      problems.push(`${vp.id}/${shot.id}: 선택된 tab 한 개만 tab stop이 아니다`);
    } else if (after.visiblePanel?.id !== selectedBinding.controls || after.visiblePanel?.labelledBy !== selectedBinding.id) {
      problems.push(`${vp.id}/${shot.id}: 선택 tab과 보이는 tabpanel의 id 연결이 틀리다`);
    }
    if (vp.width < 640 && (!after.scrollHintVisible || !after.tablistScrollable)) {
      problems.push(`${vp.id}/${shot.id}: 375px에서 가로 이동 힌트가 보이지 않거나 갈래 줄이 밀리지 않는다`);
    }
    if (vp.width >= 640 && after.scrollHintVisible) problems.push(`${vp.id}/${shot.id}: 넓은 화면에서 375px 힌트가 보인다`);
    if (after.rawDepartmentIdentifierVisible) problems.push(`${vp.id}/${shot.id}: raw dept UUID가 사용자 문구에 보인다`);
    if (shot.tab === "목록" && after.tableHeaders.length !== EXPECT.tableColumns) {
      problems.push(`${vp.id}/${shot.id}: 표가 ${after.tableHeaders.length}열이다(목표 ${EXPECT.tableColumns})`);
    }
    if (shot.tab !== "목록" && after.tableHeaders.length > 0) {
      problems.push(`${vp.id}/${shot.id}: 「${shot.tab}」 갈래인데 목록의 표가 아직 떠 있다`);
    }
    if (shot.id === "5-reporting-unknown" && !after.reportsToCells.every((cell) => cell === "모름")) {
      problems.push(`${vp.id}/${shot.id}: 보고 예외를 못 읽었는데 「모름」이 아니다 — ${after.reportsToCells.join("|")}`);
    }
    /*
     * ★ 한 화면 안에서 같은 것을 다르게 세지 않는다.
     *   실제로 위 요약은 「조직원 4」, 트리와 표는 5 라고 말한 적이 있다(활성만 vs 전체).
     *   둘 중 하나는 반드시 거짓말이므로, 여기서 «같은 수인지» 를 잰다.
     */
    if (shot.id === "1-list") {
      const metaPeople = Number(after.metaLine?.match(/조직원 (\d+)/)?.[1] ?? NaN);
      if (metaPeople !== after.memberRows.length) {
        problems.push(`${vp.id}/${shot.id}: 요약은 조직원 ${metaPeople} 인데 표는 ${after.memberRows.length}행이다`);
      }
    }
    /*
     * ★ 왼쪽 트리가 말하는 인원과 오른쪽 표의 행수가 같아야 한다.
     *   PR #641 검수가 P1 으로 잡은 자리다 — 트리는 조직도 기준, 표는 요약 기준이라
     *   모집단이 갈리면 한 부서가 「4명」과 「2행」으로 동시에 말해진다.
     *   여기서 «부서를 골라» 실제로 대조한다.
     */
    if (shot.id === "1-list-picked") {
      const tree = after.treeCounts.find((row) => row.name === shot.pick);
      if (!tree) problems.push(`${vp.id}/${shot.id}: 트리에서 「${shot.pick}」 를 못 찾았다`);
      else if (tree.reach !== after.memberRows.length) {
        problems.push(`${vp.id}/${shot.id}: 트리는 「${shot.pick} ${tree.reach}」인데 표는 ${after.memberRows.length}행이다`);
      }
    }
    // 조직도 카드는 «하나라도» 0명이면 의심한다. 전부 0일 때만 잡으면 한 부서만 틀린 경우를 놓친다.
    if (shot.id === "2-chart" && after.chartCounts.some((n) => n === "0")) {
      problems.push(`${vp.id}/${shot.id}: 조직도에 0명인 부서가 있다 — ${after.chartCounts.join("|")}`);
    }
    if (after.wrappedTabs.length) problems.push(`${vp.id}/${shot.id}: 갈래 글자가 접혔다 — ${after.wrappedTabs.join("|")}`);
    if (after.bodyOverflowsX) problems.push(`${vp.id}/${shot.id}: 몸통이 가로로 넘친다`);
    if (pageErrors.length) problems.push(`${vp.id}/${shot.id} console: ${pageErrors.join(" | ")}`);

    const file = `${OUT}/${shot.id}-${vp.id}.png`;
    await page.screenshot({ path: file, fullPage: true });
    report.push({ viewport: vp.id, shot: shot.id, file, ...after });
    await page.close();
  }
}

/*
 * ★ 전체 재적재를 견디는가.
 *   권한표의 역할 링크는 평범한 <a href="?role=..."> 라서 Next 16 에서 «전체 재적재» 다.
 *   갈래가 클라이언트 state 에만 있으면 권한 갈래에서 역할을 누를 때마다 목록으로 튕긴다.
 *   PR #641 검수가 P1 으로 잡았고, 그때 이 검사는 갈래마다 새로 열기만 해서 못 잡았다.
 */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${ORIGIN}/login/visual-fixture?surface=organization-views`, { waitUntil: "networkidle" });
  const permTab = page.getByRole("tab", { name: "권한" });
  for (let attempt = 0; attempt < 40 && (await permTab.getAttribute("aria-selected")) !== "true"; attempt += 1) {
    await permTab.click();
    await page.waitForTimeout(250);
  }
  const before = await page.locator('[role="tab"][aria-selected="true"]').textContent();

  // 역할 링크를 «실제로» 누른다 — 전체 재적재가 일어난다.
  await page.locator("a[data-role]").first().click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const after = await page.locator('[role="tab"][aria-selected="true"]').textContent();

  console.log(`\n전체 재적재 견디기 — 누르기 전 「${before?.trim()}」 → 재적재 후 「${after?.trim()}」`);
  if (after?.trim() !== "권한") {
    problems.push(`권한 갈래에서 역할 링크를 누르니 「${after?.trim()}」 로 튕겼다 — 갈래가 URL 에 없다`);
  }
  await page.screenshot({ path: `${OUT}/6-after-reload-1440x900.png`, fullPage: true });
  await page.close();
}

fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));

for (const row of report) {
  console.log(
    `${row.viewport.padEnd(9)} ${row.shot.padEnd(20)} 선택 ${String(row.selectedTab).padEnd(14)} 표 ${row.tableHeaders.length}열/${row.memberRows.length}행  오른쪽 ${row.paneTitle ?? "-"}  가로넘침 ${row.bodyOverflowsX ? "★있음" : "없음"}`,
  );
}

} finally {
  await browser?.close();
  if (serverChild) await stopServer(serverChild, ORIGIN);
}

if (problems.length) {
  console.error(`\n★ ${problems.length}건 어긋남`);
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}
console.log(`\n✅ 갈래 ${EXPECT.tabs} · tab/tabpanel/키보드 · 375px 힌트 · UUID 비노출 · 표 ${EXPECT.tableColumns}열 · 부서↔사람 연결 — 모두 확인`);
