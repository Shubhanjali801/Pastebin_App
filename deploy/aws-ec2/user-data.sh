#!/bin/bash
# EC2 user-data for Pastebin: paste into "Advanced details > User data" when launching
# an Amazon Linux 2023 instance (or pass via --user-data). On first boot it installs
# Docker, writes the compose file, pulls the app from ECR, and brings the stack up with
# a live HTTPS URL. Paste content goes to S3; only metadata is in the local Postgres.
#
# Requires: the ec2-pastebin instance role (ECR read + S3 + SSM) AND IMDSv2 hop limit 2
# (so the containerized AWS SDK can fetch S3 credentials from instance metadata).
set -euxo pipefail

REGION="ap-south-1"
ACCOUNT="197002356271"
APP_DIR="/opt/pastebin"
S3_BUCKET="pastebin-blobs-197002356271-aps1"

# --- install Docker + compose plugin (Amazon Linux 2023) ---
dnf install -y docker
systemctl enable --now docker
usermod -aG docker ec2-user
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# --- write the compose file ---
mkdir -p "$APP_DIR"
cat > "$APP_DIR/docker-compose.yml" <<YAML
name: pastebin
services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: pastebin
      POSTGRES_PASSWORD: pastebin
      POSTGRES_DB: pastebin
    volumes:
      - pgdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pastebin"]
      interval: 5s
      timeout: 3s
      retries: 15
    restart: unless-stopped
  redis:
    image: redis:7-alpine
    restart: unless-stopped
  app:
    image: ${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/pastebin:latest
    command: sh -c "npx prisma migrate deploy && node dist/index.js"
    environment:
      PORT: "3000"
      DATABASE_URL: "postgresql://pastebin:pastebin@postgres:5432/pastebin?schema=public"
      REDIS_URL: "redis://redis:6379"
      BASE_URL: "\${BASE_URL:-http://localhost:3000}"
      BLOB_BACKEND: "s3"
      S3_BUCKET: "${S3_BUCKET}"
      AWS_REGION: "${REGION}"
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate --url http://app:3000
    depends_on:
      - app
    restart: unless-stopped
volumes:
  pgdata:
YAML

# --- ECR login, start, capture the tunnel URL, set BASE_URL ---
cd "$APP_DIR"
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
docker compose up -d

URL=""
for i in $(seq 1 40); do
  URL=$(docker compose logs cloudflared 2>/dev/null \
        | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1 || true)
  [ -n "$URL" ] && break
  sleep 3
done
BASE_URL="$URL" docker compose up -d app
echo "$URL" > "$APP_DIR/LIVE_URL.txt"

# Publish the live URL to S3 so it can be retrieved without SSH/SSM (the instance role
# has PutObject on the bucket). Read it with:
#   aws s3 cp s3://<bucket>/_deploy/LIVE_URL.txt -
aws s3 cp "$APP_DIR/LIVE_URL.txt" "s3://$S3_BUCKET/_deploy/LIVE_URL.txt" --region "$REGION" || true
