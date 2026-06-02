#!/usr/bin/env bash
# Full system-dependency install for a bare Ubuntu 24.04 box -> Ecliptrix prod.
# Installs: Node 20 (NodeSource), PostgreSQL 16, nginx, ffmpeg, redis, certbot,
#           build toolchain + python venv support.
# Idempotent enough to re-run. Logs everything; ends with SYSDEPS_DONE_OK on success.
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive

step() { echo "===== [$(date '+%H:%M:%S')] $* ====="; }

step "apt update + base tools"
apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release apt-transport-https \
    build-essential git

step "NodeSource repo (Node 20.x)"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh
fi

step "apt install main packages"
apt-get install -y \
    nodejs \
    python3-venv python3-dev python3-pip \
    postgresql postgresql-client libpq-dev \
    ffmpeg \
    fonts-noto-cjk \
    nginx \
    redis-server \
    certbot python3-certbot-nginx

step "enable + start services"
systemctl enable --now postgresql || true
systemctl enable --now redis-server || true
systemctl enable --now nginx || true

step "versions"
echo "node:    $(node --version 2>&1)"
echo "npm:     $(npm --version 2>&1)"
echo "python3: $(python3 --version 2>&1)"
echo "psql:    $(psql --version 2>&1)"
echo "pg_svc:  $(systemctl is-active postgresql 2>&1)"
echo "ffmpeg:  $(ffmpeg -version 2>&1 | head -1)"
echo "nginx:   $(nginx -v 2>&1)"
echo "redis:   $(redis-cli --version 2>&1) / svc=$(systemctl is-active redis-server 2>&1)"
echo "certbot: $(certbot --version 2>&1)"

# Final gate: fail loudly if any critical binary is missing
MISSING=""
for b in node npm psql ffmpeg nginx redis-cli certbot; do
  command -v "$b" >/dev/null 2>&1 || MISSING="$MISSING $b"
done
if [ -n "$MISSING" ]; then
  echo "MISSING BINARIES:$MISSING"
  exit 1
fi
echo "SYSDEPS_DONE_OK"
