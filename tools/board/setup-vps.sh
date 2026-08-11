#!/usr/bin/env bash
# 관제판을 VPS 에 올려 «항상 켜져 있게» 만든다 — VPS 안에서 실행한다
#
# 왜 VPS 인가
#   데스크톱에서 돌리면 컴퓨터를 켜두고 창도 띄워둬야 한다.
#   VPS 는 원래 늘 켜져 있으니 주소만 치면 어디서든 보인다.
#
# 무엇이 만들어지나
#   /opt/moawork-board/            서버·템플릿·키
#   systemd 서비스 moawork-board   재부팅해도 자동으로 뜬다
#   tailscale serve                tailnet 안에서만 열린다 (인터넷 공개 아님)
#
# 쓰는 법 (VPS 안에서)
#   sudo bash setup-vps.sh
set -euo pipefail

APP=/opt/moawork-board
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=8787

echo "══ 1/6 · 사전 확인 ══"
[ "$(id -u)" -eq 0 ] || { echo "❌ sudo 로 실행해라:  sudo bash setup-vps.sh"; exit 1; }
for f in server.mjs board.template.html; do
  [ -f "$SRC/$f" ] || { echo "❌ $SRC/$f 가 없다. 데스크톱에서 먼저 복사해라."; exit 1; }
done
echo "  파일 확인 OK"

echo "══ 2/6 · node 확인 (fetch 때문에 18 이상이어야 한다) ══"
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  V=$(node -p "process.versions.node.split('.')[0]")
  echo "  현재 node v$(node -p process.versions.node)"
  [ "$V" -ge 18 ] && NODE_OK=1
fi
if [ "$NODE_OK" -eq 0 ]; then
  echo "  node 18+ 를 설치한다"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  echo "  설치됨 v$(node -p process.versions.node)"
fi

echo "══ 3/6 · 파일 배치 ══"
mkdir -p "$APP"
install -m 644 "$SRC/server.mjs"           "$APP/server.mjs"
install -m 644 "$SRC/board.template.html"  "$APP/board.template.html"
if [ -f "$SRC/.env" ]; then
  install -m 600 "$SRC/.env" "$APP/.env"
  echo "  .env 복사됨 (권한 600 — 이 서버의 root 만 읽는다)"
elif [ ! -f "$APP/.env" ]; then
  cat > "$APP/.env" <<'EOF'
# Linear 개인 API 키 — 읽기 전용 권장
# https://linear.app/settings/account/security → API keys → New API key
LINEAR_API_KEY=
DASHBOARD_PORT=8787
EOF
  chmod 600 "$APP/.env"
  echo "  ⚠️ .env 를 만들었으나 키가 비어 있다 — 아래 6/6 을 보라"
fi
echo "  $APP 배치 완료"

echo "══ 4/6 · systemd 서비스 ══"
cat > /etc/systemd/system/moawork-board.service <<EOF
[Unit]
Description=MoaWork 관제판 (Linear 실시간)
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP
ExecStart=/usr/bin/env node $APP/server.mjs
Restart=always
RestartSec=5
# 키가 담긴 .env 를 읽으므로 파일 접근을 좁힌다
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable moawork-board >/dev/null
systemctl restart moawork-board
sleep 2
systemctl --no-pager --lines=6 status moawork-board || true

echo "══ 5/6 · tailnet 에만 열기 ══"
if command -v tailscale >/dev/null 2>&1; then
  tailscale serve --bg --https=443 "localhost:$PORT" || \
    echo "  ⚠️ serve 실패 — 화면에 뜬 안내 주소를 열어 Serve 를 켜고 다시 실행해라"
  echo
  tailscale serve status || true
else
  echo "  ⚠️ tailscale 명령이 없다. VPS 에 Tailscale 이 설치돼 있는지 확인해라"
fi

echo
echo "══ 6/6 · 확인 ══"
if grep -q '^LINEAR_API_KEY=lin_api_' "$APP/.env" 2>/dev/null; then
  echo "  ✅ Linear 키 있음"
else
  echo "  ⚠️ Linear 키가 비어 있다. 이렇게 넣어라 —"
  echo "       sudo nano $APP/.env      (LINEAR_API_KEY= 뒤에 붙여넣기)"
  echo "       sudo systemctl restart moawork-board"
fi
echo
echo "  로컬 확인 :  curl -s -o /dev/null -w '%{http_code}\\n' http://localhost:$PORT/"
echo "  로그 보기 :  journalctl -u moawork-board -f"
echo "  다시 시작 :  sudo systemctl restart moawork-board"
echo
echo "  브라우저 주소는 위 «tailscale serve status» 에 찍힌 https://... 이다."
echo "  tailnet 에 붙은 기기(데스크톱·노트북)에서만 열린다. 인터넷 공개가 아니다."
