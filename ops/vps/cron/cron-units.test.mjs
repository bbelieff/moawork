// 야간 배치 크론의 «깨지면 조용한» 성질들을 고정한다.
//
// 이 크론은 실패해도 사용자 화면에 아무 표시가 없다. 지표가 하루 비는 것뿐이라
// 몇 주 뒤에야 발견된다(실제로 버셀→VPS 이전 때 그렇게 비었다). 그래서
// 「시간이 맞나」「시크릿이 새나」 같은 것을 사람 눈 대신 여기서 잡는다.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const read = (name) =>
  readFile(fileURLToPath(new URL(name, import.meta.url)), "utf8");

test("timer runs after midnight KST and catches up a missed day", async () => {
  const timer = await read("./moawork-platform-metrics.timer");
  // «완료된 하루» 를 집계하므로 자정 전에 돌면 안 된다.
  assert.match(timer, /^OnCalendar=\*-\*-\* 04:00:00 Asia\/Seoul$/mu);
  // 호스트 시간대 설정에 결과가 좌우되면 안 된다.
  assert.match(timer, /Asia\/Seoul/u);
  // 서버가 꺼져 있던 날을 건너뛰지 않는다(적재는 멱등).
  assert.match(timer, /^Persistent=true$/mu);
  assert.match(timer, /^Unit=moawork-platform-metrics\.service$/mu);
});

test("service is a oneshot that never declares an illegal restart", async () => {
  const service = await read("./moawork-platform-metrics.service");
  assert.match(service, /^Type=oneshot$/mu);
  // systemd 는 Type=oneshot 에 Restart= 를 거부한다. 넣으면 유닛이 아예 안 뜬다.
  assert.doesNotMatch(service, /^Restart=/mu);
  // 앱과 같은 env 파일을 읽어야 CRON_SECRET 이 한쪽만 바뀌는 사고가 없다.
  assert.match(service, /^EnvironmentFile=\/etc\/moawork\/runtime\.env$/mu);
  assert.match(service, /^After=.*moawork-direct\.service/mu);
});

test("the runner keeps the secret out of the process table", async () => {
  const script = await read("./moawork-platform-metrics.sh");
  // 헤더는 stdin 설정(-K -)으로만 넘긴다. 인자로 넘기면 `ps` 에 그대로 보인다.
  assert.match(script, /--config -/u);
  assert.doesNotMatch(script, /-H .*CRON_SECRET/u);
  assert.doesNotMatch(script, /--header .*CRON_SECRET/u);
});

test("the runner fails loudly instead of reporting a silent success", async () => {
  const script = await read("./moawork-platform-metrics.sh");
  // 시크릿이 없으면 «안 돌았다» 를 남긴다.
  assert.match(script, /CRON_SECRET is not set/u);
  // 207(부분 실패)을 성공으로 삼키지 않는다.
  assert.match(script, /\[ "\$code" = "200" \] \|\| exit 1/u);
  assert.match(script, /^set -eu$/mu);
  // 백필 날짜는 형식을 확인하고 넘긴다.
  assert.match(script, /day must be YYYY-MM-DD/u);
});
