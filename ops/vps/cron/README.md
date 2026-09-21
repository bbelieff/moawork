# 야간 배치 크론 (platform-metrics)

하루치 플랫폼 지표(`dau` · `mau` · `stickiness` · `active_users` · `dormant_users` ·
`new_deals`)를 `platform_metrics_daily` 에 적재한다. 매일 **KST 04:00** 에 한 번 돈다.

## 왜 여기로 왔나

원래는 `app/vercel.json` 의 Vercel Cron 이 호출했다. 운영이 VPS 로 옮겨 오면서 그 파일이
같이 사라졌고, **대체 크론을 두지 않아 그날부터 지표가 비었다.** 이 크론이 그 자리를 잇는다.

이 배치는 실패해도 사용자 화면에 아무 표시가 없다. 그래서 조용히 멈추지 않도록
- 시크릿이 없으면 **실패로 남기고**(성공으로 삼키지 않는다),
- 207(부분 실패)도 실패로 보고,
- 서버가 꺼져 있던 날은 `Persistent=true` 로 다음 부팅 때 따라잡는다(적재는 멱등).

## 왜 «한 번도» 안 돌았나 (2026-09-20 실측)

키가 없어서만이 아니다. `app/src/proxy.ts`(Next 16 미들웨어)가 `/login`·`/auth/*` 와
health 2개를 빼고 **모든 경로**를 세션 게이트로 막고 있었다. 배치는 사람 세션이 아니라
`CRON_SECRET` 으로 오므로 `/login` 으로 307 되어 라우트에 **닿지도 못했다.**

```
$ curl -i http://127.0.0.1:3100/api/cron/platform-metrics
HTTP/1.1 307 Temporary Redirect
location: /login?next=%2Fapi%2Fcron%2Fplatform-metrics
```

그래서 이 경로를 게이트 예외로 뒀다. «열어 둔» 것이 아니다 — 라우트가
`CRON_SECRET` 미설정이면 503, 토큰 불일치면 401 로 fail-closed 한다.
세션 게이트 대신 그 게이트를 쓴다. 예외는 **정확히 이 한 경로**뿐이고,
하위·유사 경로가 새지 않는지는 `app/src/proxy.test.ts` 가 지킨다.

## 설치 전에 — 총괄이 직접 넣어야 하는 값 2개

둘 다 **자격증명이라 저장소·대화·로그에 남기지 않는다.** 서버에서 직접 넣는다.

```sh
# 1) 배치 엔드포인트 인증용 시크릿 (새로 만든다)
printf 'CRON_SECRET=%s\n' "$(openssl rand -hex 32)" >> /etc/moawork/runtime.env

# 2) 집계가 쓰는 Supabase service_role 키
#    Supabase → Settings → API → service_role 값을 붙여넣는다.
#    ⚠ NEXT_PUBLIC_ 접두사를 붙이면 브라우저로 새어 나간다. 절대 붙이지 않는다.
printf 'SUPABASE_SERVICE_ROLE_KEY=%s\n' '<여기에 붙여넣기>' >> /etc/moawork/runtime.env

chmod 600 /etc/moawork/runtime.env
systemctl restart moawork-direct        # 앱이 두 값을 읽어야 한다
```

`CRON_SECRET` 은 앱이 검증하고 크론이 제시한다. 둘이 **같은 파일**(`runtime.env`)을 읽으므로
한쪽만 바꿔서 조용히 401 로 죽는 일이 없다.

## 설치

```sh
install -m 755 ops/vps/cron/moawork-platform-metrics.sh /usr/local/bin/
install -m 644 ops/vps/cron/moawork-platform-metrics.service /etc/systemd/system/
install -m 644 ops/vps/cron/moawork-platform-metrics.timer   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now moawork-platform-metrics.timer
```

## 확인

```sh
systemctl list-timers moawork-platform-metrics.timer   # 다음 실행 시각
systemctl start moawork-platform-metrics.service       # 지금 한 번 돌려 본다
journalctl -u moawork-platform-metrics.service -n 30 --no-pager
```

성공이면 로그에 `platform-metrics ... -> 200` 과 집계 결과가 찍힌다.
`503` 은 `CRON_SECRET` 미설정, `401` 은 값 불일치, `501` 은 Supabase 연결 설정 누락이다.

## 빠진 날 메우기 (백필)

**2026-09-20 실측**: `platform_metrics_daily` 는 **0행**이다. 버셀 이전 이후가 아니라
«한 번도» 적재된 적이 없다. 원본도 아직 적다 — 조직 5 · 딜 6(2026-08-23~09-15) ·
`activities` 0행. 그래서 백필해도 대부분의 날은 0 으로 채워진다. 그게 정상이고,
숫자가 0 이라고 배치가 실패한 것이 아니다.

`activities` 가 비어 있는 한 DAU·MAU·stickiness 는 계속 0 이다. 그건 이 크론이 아니라
활동 기록(딜 단계 이동) 쪽 이야기다 — 이 크론을 고쳐도 그 값은 안 올라간다.

적재는 멱등 upsert 라 같은 날짜를 여러 번 돌려도 중복되지 않는다.
첫 딜이 생긴 날부터 메우려면 `2026-08-23` 부터 어제까지 돌린다.

```sh
/usr/local/bin/moawork-platform-metrics.sh 2026-09-18
# 여러 날
for d in 2026-09-15 2026-09-16 2026-09-17; do
  /usr/local/bin/moawork-platform-metrics.sh "$d" || echo "실패: $d"
done
```

스크립트는 `EnvironmentFile` 없이 손으로 돌리면 `CRON_SECRET` 을 못 읽는다.
그때는 `set -a; . /etc/moawork/runtime.env; set +a` 를 먼저 한다.

## 끄기

```sh
systemctl disable --now moawork-platform-metrics.timer
```
