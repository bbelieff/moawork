#!/usr/bin/env node
/**
 * 영업 흐름 데모 업체 — 넣고 · 보고 · 지운다. (2026-10-19 belie «업체명이 그 업체의 끝을 예상할 수 있게»)
 *
 * ★ 이것은 «제품» 이 아니다. 개발·검수용 도구다. 빈 워크스페이스가 기본이라는 규칙은 그대로다.
 *   이 스크립트를 돌려야만 데모 업체가 생긴다.
 *
 * ★ 앱과 «같은 길» 로 넣는다 — 테이블에 직접 쓰지 않고, 앱이 부르는 RPC 를 그 회사 대표로 부른다
 *   (set role authenticated + request.jwt.claims). 그래서 deal·item·상담 상태·인계·실무 보드 이동의 불변식이
 *   앱에서 누른 것과 같다. 이름이 결말을 말한다: 「비대면계약·신보승인상사」 는 비대면으로 계약해 신보에서 승인됐다.
 *
 * ★ 표식과 지우기 — 모든 데모 deal 의 deal_intake.source_external_id 가 'seed-demo:<번호>' 다.
 *   --remove 는 그 표식이 붙은 것만 지운다(인계로 «새로 만든» 회사도, 다른 deal 이 쓰지 않을 때만).
 *
 * ★ 외부 발송 — 시작 전에 그 회사의 켜진 메시지 발송 규칙이 0건인지 본다. 하나라도 있으면 멈춘다.
 *   담당자는 언제나 대표 본인이라 «다른 사람에게 배정» 장부(지울 수 없음)를 만들지 않는다.
 *
 * 사용법 (접속 문자열은 현재 폴더의 .env.local / .env 의 SUPABASE_DB_URL)
 *   node scripts/pipeline-demo-seed.mjs --status --org <slug|id>
 *   node scripts/pipeline-demo-seed.mjs --apply  --org <slug|id> [--dry]
 *   node scripts/pipeline-demo-seed.mjs --remove --org <slug|id>
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const ENV_FILES = [".env.local", ".env"];
const URL_KEY = "SUPABASE_DB_URL";
const MARK = "seed-demo:";
const SOURCES = {
  newLead: "core.default-tab/new-lead",
  contact: "core.default-tab/contact",
  work: "core.default-tab/contract-work",
};

// ── 시나리오 ────────────────────────────────────────────────────────────────
// path: 어디서 멈추는가. 이름은 «멈춘 곳» 을 그대로 말한다.
const INSTITUTIONS = [
  { short: "재단", value: "재단_서울보증", fund: "일시적경영애로자금", product: "일반운전자금" },
  { short: "신보", value: "간접_신보", fund: "혁신성장자금", product: "특례보증" },
  { short: "기보", value: "간접_기보", fund: "혁신성장자금", product: "혁신성장지원" },
  { short: "소진공", value: "소상공인_직접대출", fund: "신용취약소상공인자금", product: "긴급경영안정" },
  { short: "중진공", value: "직접_중진공", fund: "청년고용연계자금", product: "일반운전자금" },
];
const WORK_STATUSES = [
  { label: "대기", value: "대기중" },
  { label: "진행", value: "진행중" },
  { label: "심사중", value: "심사 중" },
  { label: "승인", value: "승인" },
  { label: "불가", value: "불가" },
];

function scenarios() {
  const list = [];
  const push = (name, path) => list.push({ n: list.length + 1, name, ...path });
  // 신규리드에서 멈춤
  push("신규대기상사", { stage: "newlead", consult: null });
  push("1차부재전자", { stage: "newlead", consult: "1차 부재" });
  push("2차상담예약식품", { stage: "newlead", consult: "2차 상담예약" });
  push("2차상담완료물산", { stage: "newlead", consult: "2차 상담완료" });
  push("신규보류산업", { stage: "newlead", consult: "보류" });
  push("신규거절상회", { stage: "newlead", consult: "거절" });
  // 비대면 상담에서 멈춤
  for (const [phase, label, time] of [
    ["information", "정보수집", false], ["scheduled", "상담예정", true], ["consulting", "상담중", false],
    ["absent", "부재", false], ["on_hold", "보류", false], ["rejected", "거절", false], ["follow_up", "재상담", true],
  ]) push(`비대면${label}상사`, { stage: "remote", phase, time });
  // 대면 상담에서 멈춤
  for (const [phase, label] of [
    ["meeting_scheduled", "미팅예약"], ["meeting_done", "미팅완료"], ["cancelled", "미팅취소"], ["deliberating", "고민중"],
  ]) push(`대면${label}테크`, { stage: "inperson", phase });
  // 대면에서 비대면으로 돌아와 계약 확인
  push("대면후비대면계약확인상사", { stage: "back-to-remote" });
  // 계약 단계에서 멈춤(인계 전)
  for (const via of ["remote", "inperson"]) {
    const v = via === "remote" ? "비대면" : "대면";
    push(`${v}계약금대기상사`, { stage: "contract", via, fee: false, seal: false });
    push(`${v}직인대기상사`, { stage: "contract", via, fee: true, seal: false });
    push(`${v}계약확인완료상사`, { stage: "contract", via, fee: true, seal: true });
  }
  // 실무로 넘어감 — 기관 5 × 상태 5, 계약 경로는 번갈아
  let k = 0;
  for (const inst of INSTITUTIONS) {
    for (const st of WORK_STATUSES) {
      const via = k % 2 === 0 ? "remote" : "inperson";
      const v = via === "remote" ? "비대면계약" : "대면계약";
      push(`${v}·${inst.short}${st.label}상사`, { stage: "work", via, inst, status: st });
      k += 1;
    }
  }
  return list;
}

const REGIONS = [["서울", "강남구"], ["경기", "수원시"], ["부산", "해운대구"], ["대구", "수성구"], ["인천", "남동구"], ["광주", "북구"], ["대전", "유성구"], ["경남", "창원시"]];
const INDUSTRIES = ["제조업", "도소매업", "서비스업", "건설업", "운수업", "정보통신업"];
const BIZ = ["개인사업자", "법인사업자", "개인사업자(간이)"];
const BANDS = ["1,000만원~2,000만원", "2,000만원~4,000만원", "6,000만원~9,000만원"];

// ── 공통 ────────────────────────────────────────────────────────────────────
function uuidv5(name) {
  const hash = createHash("sha1").update(`moawork-pipeline-demo/${name}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function readConnectionString() {
  for (const name of ENV_FILES) {
    const path = resolve(process.cwd(), name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0 || trimmed.slice(0, eq).trim() !== URL_KEY) continue;
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (value) return value;
    }
  }
  return null;
}
const redact = (text, secret) => String(text ?? "").split(secret || "\u0000").join(`<${URL_KEY}>`).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "<redacted>");

function parseArgs(argv) {
  const args = { mode: null, org: null, dry: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--status" || a === "--apply" || a === "--remove") args.mode = a.slice(2);
    else if (a === "--org") args.org = argv[++i];
    else if (a === "--dry") args.dry = true;
  }
  if (!args.mode || !args.org) throw new Error("사용법: --status|--apply|--remove --org <slug|id> [--dry]");
  return args;
}

async function context(client, needle) {
  const org = (await client.query("select id, name, slug from orgs where id::text = $1 or slug = $1", [needle])).rows;
  if (org.length !== 1) throw new Error(`회사를 하나로 찾지 못했어요: ${needle} (${org.length}건)`);
  const orgId = org[0].id;
  const owner = (await client.query("select user_id from org_members where org_id=$1 and role='owner' and status='active' order by created_at limit 1", [orgId])).rows[0];
  if (!owner) throw new Error("활성 대표가 없습니다.");
  const boards = (await client.query("select id, source from boards where org_id=$1 and source = any($2)", [orgId, Object.values(SOURCES)])).rows;
  const boardOf = (source) => {
    const hits = boards.filter((b) => b.source === source);
    if (hits.length !== 1) throw new Error(`${source} 보드가 정확히 1개가 아닙니다(${hits.length}).`);
    return hits[0].id;
  };
  return { org: org[0], orgId, ownerId: owner.user_id, newLeadBoard: boardOf(SOURCES.newLead), contactBoard: boardOf(SOURCES.contact), workBoard: boardOf(SOURCES.work) };
}

async function asOwner(client, ctx, fn) {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [
      JSON.stringify({ sub: ctx.ownerId, role: "authenticated" }), ctx.ownerId,
    ]);
    const out = await fn();
    await client.query("commit");
    return out;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

async function boardVersion(client, boardId) {
  return (await client.query("select row_order_version from boards where id=$1", [boardId])).rows[0].row_order_version;
}

async function itemBoard(client, itemId) {
  return (await client.query("select board_id, group_id from items where id=$1", [itemId])).rows[0];
}

/** 이동 규칙을 지키며 칸을 쓴다 — 규칙이 있으면 그 그룹으로, 없으면 지금 그룹에 그대로. */
async function setValues(client, ctx, itemId, values, step) {
  const at = await itemBoard(client, itemId);
  let target = at.group_id;
  for (const [key, value] of Object.entries(values)) {
    const rule = (await client.query("select move_rule_jsonb from board_columns where board_id=$1 and key=$2", [at.board_id, key])).rows[0]?.move_rule_jsonb;
    if (rule && typeof value === "string" && rule[value]) target = rule[value];
  }
  await client.query(
    "select * from set_board_item_values_with_atomic_move($1,$2,$3,$4::jsonb,$5,null,$6,$7)",
    [ctx.orgId, at.board_id, itemId, JSON.stringify(values), target, await boardVersion(client, at.board_id), uuidv5(step)],
  );
}

async function snapshot(client, ctx, itemId) {
  return (await client.query("select version, mode, phase from read_consultation_snapshot_v2($1,$2)", [ctx.orgId, itemId])).rows[0];
}

async function workflow(client, ctx, itemId, mode, phase, step, { meetingAt = null, cancel = false } = {}) {
  const snap = await snapshot(client, ctx, itemId);
  await client.query("select * from execute_consultation_workflow($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
    ctx.orgId, itemId, uuidv5(step), snap?.version ?? 0, mode, phase, meetingAt, meetingAt ? ctx.ownerId : null, cancel,
  ]);
  await client.query("select mirror_consultation_meeting_at($1,$2)", [ctx.orgId, itemId]);
}

async function seal(client, ctx, itemId, operation, step, companyName = null) {
  const snap = await snapshot(client, ctx, itemId);
  await client.query("select * from execute_consultation_seal_handoff($1,$2,$3,$4,$5,$6)", [
    ctx.orgId, itemId, uuidv5(step), snap.version, operation, companyName,
  ]);
}

const daysFromNow = (d, h = 14) => {
  const t = new Date(); t.setDate(t.getDate() + d); t.setHours(h, 0, 0, 0); return t.toISOString();
};

async function seedOne(client, ctx, s) {
  const key = `${ctx.orgId}:${s.n}`;
  const firstGroup = (await client.query("select id from board_groups where board_id=$1 order by sort_order limit 1", [ctx.newLeadBoard])).rows[0].id;
  const [sido, sigungu] = REGIONS[s.n % REGIONS.length];
  const created = (await client.query(
    `select * from create_new_lead_with_founded_month($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [ctx.orgId, ctx.newLeadBoard, firstGroup, uuidv5(`${key}:create`), s.name, `데모대표${s.n}`,
      `0100000${String(1000 + s.n).slice(-4)}`, `demo${s.n}@demo.invalid`, BIZ[s.n % BIZ.length], INDUSTRIES[s.n % INDUSTRIES.length], null,
      BANDS[s.n % BANDS.length], sido, sigungu, "데모시드", `${MARK}${s.n}`, null, null, [], `${2015 + (s.n % 9)}-${String(1 + (s.n % 12)).padStart(2, "0")}`],
  )).rows[0];
  const itemId = created.item_id;

  if (s.stage === "newlead") {
    if (s.consult) await setValues(client, ctx, itemId, { consult_status: s.consult }, `${key}:nl`);
    return;
  }
  // 리드컨택(상담)으로
  const adv = (await client.query("select * from advance_new_lead_to_contact($1,$2)", [itemId, uuidv5(`${key}:advance`)])).rows[0];
  if (!["committed", "replayed", "advanced", "ok"].includes(adv.status)) {
    throw new Error(`리드컨택으로 넘기지 못함: ${adv.status} ${adv.reason ?? ""}`);
  }

  if (s.stage === "remote") {
    await workflow(client, ctx, itemId, "remote", s.phase, `${key}:remote`, { meetingAt: s.time ? daysFromNow(2) : null });
    return;
  }
  if (s.stage === "inperson") {
    await workflow(client, ctx, itemId, "remote", "consulting", `${key}:r1`);
    await workflow(client, ctx, itemId, "inperson", "meeting_scheduled", `${key}:i1`, { meetingAt: daysFromNow(s.phase === "meeting_scheduled" ? 3 : -2) });
    if (s.phase !== "meeting_scheduled") {
      await workflow(client, ctx, itemId, "inperson", s.phase, `${key}:i2`, { cancel: s.phase === "cancelled" });
    }
    return;
  }
  if (s.stage === "back-to-remote") {
    await workflow(client, ctx, itemId, "remote", "consulting", `${key}:r1`);
    await workflow(client, ctx, itemId, "inperson", "meeting_scheduled", `${key}:i1`, { meetingAt: daysFromNow(-3) });
    await workflow(client, ctx, itemId, "inperson", "meeting_done", `${key}:i2`);
    await workflow(client, ctx, itemId, "remote", "contract", `${key}:r2`, { meetingAt: daysFromNow(1) });
    return;
  }

  // 계약까지
  const via = s.via;
  if (via === "remote") {
    await workflow(client, ctx, itemId, "remote", "consulting", `${key}:r1`);
    await workflow(client, ctx, itemId, "remote", "contract", `${key}:r2`);
  } else {
    await workflow(client, ctx, itemId, "remote", "consulting", `${key}:r1`);
    await workflow(client, ctx, itemId, "inperson", "meeting_scheduled", `${key}:i1`, { meetingAt: daysFromNow(-5) });
    await workflow(client, ctx, itemId, "inperson", "meeting_done", `${key}:i2`);
    await workflow(client, ctx, itemId, "inperson", "contract", `${key}:i3`);
  }
  const fee = s.stage === "work" ? true : s.fee;
  const sealed = s.stage === "work" ? true : s.seal;
  if (fee) await setValues(client, ctx, itemId, { contract_fee_status: "계약금 완", contract_fee: 3_300_000 }, `${key}:fee`);
  if (sealed) await seal(client, ctx, itemId, "seal_approval", `${key}:seal`);
  if (s.stage !== "work") return;

  await seal(client, ctx, itemId, "handoff", `${key}:handoff`, s.name);
  const at = await itemBoard(client, itemId);
  if (at.board_id !== ctx.workBoard) throw new Error("인계 뒤 계약업체 실무 보드로 옮겨지지 않았습니다.");
  await setValues(client, ctx, itemId, {
    engagement_kind: "자금", institution: s.inst.value, fund_name: s.inst.fund, product: s.inst.product,
  }, `${key}:work-fields`);
  const extra = s.status.value === "승인" ? { execution_amount: 50_000_000 + s.n * 1_000_000, approved_on: daysFromNow(-1).slice(0, 10) } : {};
  await setValues(client, ctx, itemId, { progress_status: s.status.value, ...extra }, `${key}:work-status`);
}

async function preflight(client, ctx) {
  const rules = (await client.query("select count(*)::int as n from messaging_trigger_rules where org_id=$1 and enabled", [ctx.orgId])).rows[0].n;
  if (rules > 0) throw new Error(`켜진 메시지 발송 규칙이 ${rules}건 있어 멈춥니다(데모 값이 실제 문자를 보낼 수 있음).`);
}

async function seededDeals(client, orgId) {
  return (await client.query(
    "select d.id as deal_id, di.source_external_id as mark from deal_intake di join deals d on d.id=di.deal_id where d.org_id=$1 and di.source_external_id like $2",
    [orgId, `${MARK}%`],
  )).rows;
}

async function status(client, ctx) {
  const rows = (await client.query(
    `select b.name as board, coalesce(g.name,'(그룹 없음)') as grp, count(*)::int as n
       from deal_intake di join items i on i.deal_id=di.deal_id join boards b on b.id=i.board_id left join board_groups g on g.id=i.group_id
      where i.org_id=$1 and di.source_external_id like $2 and i.deleted_at is null
      group by 1,2 order by 1,2`, [ctx.orgId, `${MARK}%`])).rows;
  console.log(`${ctx.org.name} 데모 업체:`);
  console.table(rows);
}

async function apply(client, ctx, dry) {
  await preflight(client, ctx);
  const done = new Set((await seededDeals(client, ctx.orgId)).map((r) => r.mark));
  const todo = scenarios().filter((s) => !done.has(`${MARK}${s.n}`));
  console.log(`넣을 업체 ${todo.length}개 (이미 있음 ${done.size}개)`);
  if (dry) { for (const s of todo) console.log(`  ${s.n}. ${s.name} — ${s.stage}`); return; }
  const failed = [];
  for (const s of todo) {
    try {
      await asOwner(client, ctx, () => seedOne(client, ctx, s));
      console.log(`  ✓ ${s.n}. ${s.name}`);
    } catch (error) {
      failed.push({ n: s.n, name: s.name, error: redact(error.message) });
      console.log(`  ✗ ${s.n}. ${s.name} — ${redact(error.message)}`);
    }
  }
  if (failed.length) { console.log(`\n실패 ${failed.length}건`); process.exitCode = 1; }
}

async function remove(client, ctx) {
  const deals = (await seededDeals(client, ctx.orgId)).map((r) => r.deal_id);
  if (deals.length === 0) { console.log("지울 데모 업체가 없습니다."); return; }
  await client.query("begin");
  try {
    await client.query("select set_config('moawork.new_lead_projection_write','on',true)");
    const items = (await client.query("select id from items where deal_id = any($1)", [deals])).rows.map((r) => r.id);
    const companies = (await client.query(
      `select distinct d.company_id from deals d
        where d.id = any($1) and d.company_id is not null
          and not exists (select 1 from deals o where o.company_id = d.company_id and not (o.id = any($1)))`, [deals])).rows.map((r) => r.company_id);
    for (const sql of [
      "delete from board_item_detail_files where item_id = any($1)",
      "delete from board_item_detail_links where item_id = any($1)",
      "delete from board_item_cloud_folder_requests where item_id = any($1)",
      "delete from board_item_detail_events where item_id = any($1)",
      "delete from company_work_start_requests where item_id = any($1)",
      "delete from company_intake_requests where item_id = any($1)",
      "delete from board_item_create_receipts where item_id = any($1)",
    ]) await client.query(sql, [items]).catch((error) => { if (error.code !== "42P01" && error.code !== "42703") throw error; });
    await client.query("delete from notifications where org_id=$1 and (entity_id = any($2::uuid[]) or entity_id = any($3::uuid[]))", [ctx.orgId, items, deals])
      .catch((error) => { if (error.code !== "42703") throw error; });
    await client.query("delete from board_row_move_requests where org_id=$1 and payload->>'item_id' = any($2::text[])", [ctx.orgId, items.map(String)])
      .catch((error) => { if (error.code !== "42703" && error.code !== "42P01") throw error; });
    const di = await client.query("delete from items where id = any($1)", [items]);
    const dd = await client.query("delete from deals where id = any($1)", [deals]);
    const dc = companies.length ? await client.query("delete from companies where id = any($1)", [companies]) : { rowCount: 0 };
    await client.query("commit");
    console.log(`지움: 행 ${di.rowCount} · 거래 ${dd.rowCount} · 회사 ${dc.rowCount}`);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = readConnectionString();
  if (!url) throw new Error(`${URL_KEY} 가 .env.local / .env 에 없습니다.`);
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const ctx = await context(client, args.org);
    if (args.mode === "status") await status(client, ctx);
    else if (args.mode === "apply") { await apply(client, ctx, args.dry); if (!args.dry) await status(client, ctx); }
    else await remove(client, ctx);
  } catch (error) {
    console.error(redact(error.message, url));
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
