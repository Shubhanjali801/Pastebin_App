#!/usr/bin/env bash
# One-command redeploy from your laptop — NO SSH, NO open ports (uses SSM).
#
#   bash deploy/aws-ec2/redeploy.sh            # rebuild + push + restart on the box
#   bash deploy/aws-ec2/redeploy.sh --no-build # just restart the box with current image
#
# Requires: the PastebinSSMAccess policy on your IAM user, and the instance registered
# with SSM (it is — the ec2-pastebin role has AmazonSSMManagedInstanceCore).
set -euo pipefail

REGION="ap-south-1"
ACCOUNT="197002356271"
INSTANCE="i-0b24fcfdb9b414e06"
# Account-owned run-shell document. The AWS public AWS-RunShellCommand is not available
# in this account (blocked/absent), so we created our own equivalent (PastebinRunShell).
SSM_DOC="PastebinRunShell"
REPO="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/pastebin"
HERE="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$HERE/../.." && pwd)" # .../app

if [ "${1:-}" != "--no-build" ]; then
  echo "==> building + pushing image (linux/amd64)"
  aws ecr get-login-password --region "$REGION" \
    | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
  docker buildx build --platform linux/amd64 -t "$REPO:latest" --push "$APP_DIR"
fi

echo "==> sending redeploy to $INSTANCE via SSM"
# base64 (single line) sidesteps all shell/JSON quoting when passing the remote script.
B64=$(base64 -w0 "$HERE/remote-redeploy.sh")
CMD=$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE" \
  --document-name "$SSM_DOC" --comment "pastebin redeploy" \
  --parameters "commands=[\"echo $B64 | base64 -d > /tmp/rd.sh && bash /tmp/rd.sh\"]" \
  --query 'Command.CommandId' --output text)
echo "    command id: $CMD"

echo "==> waiting for completion"
for i in $(seq 1 80); do
  STATUS=$(aws ssm get-command-invocation --region "$REGION" \
    --command-id "$CMD" --instance-id "$INSTANCE" --query 'Status' --output text 2>/dev/null || echo Pending)
  case "$STATUS" in
    Success) break ;;
    Failed|Cancelled|TimedOut)
      echo "!! redeploy $STATUS — stderr:"
      aws ssm get-command-invocation --region "$REGION" --command-id "$CMD" \
        --instance-id "$INSTANCE" --query 'StandardErrorContent' --output text
      exit 1 ;;
  esac
  sleep 5
done

echo "==> done. Live URL:"
aws ssm get-command-invocation --region "$REGION" --command-id "$CMD" \
  --instance-id "$INSTANCE" --query 'StandardOutputContent' --output text | grep LIVE_URL
