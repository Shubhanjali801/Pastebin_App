#!/usr/bin/env bash
# Runs ON the EC2 instance (invoked via SSM by redeploy.sh). Pulls the latest image
# from ECR, restarts the app, re-captures the Cloudflare tunnel URL, and publishes it
# to S3. cloudflared is NOT restarted, so the public URL stays the same across app
# redeploys (it only changes if the tunnel container itself restarts).
set -euo pipefail
REGION="ap-south-1"
ACCOUNT="197002356271"
BUCKET="pastebin-blobs-197002356271-aps1"

cd /opt/pastebin
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

docker compose pull
docker compose up -d

# Use tail -1 (NEWEST url), not head -1: after an instance stop/start the cloudflared
# container restarts and gets a new tunnel URL, but its old url line is still in the
# persisted logs. head -1 would grab the stale/dead url; tail -1 gets the current one.
URL=""
for i in $(seq 1 40); do
  URL=$(docker compose logs cloudflared 2>/dev/null \
        | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
  [ -n "$URL" ] && break
  sleep 3
done

BASE_URL="$URL" docker compose up -d app
echo "$URL" > LIVE_URL.txt
aws s3 cp LIVE_URL.txt "s3://$BUCKET/_deploy/LIVE_URL.txt" --region "$REGION" || true
echo "LIVE_URL=$URL"
