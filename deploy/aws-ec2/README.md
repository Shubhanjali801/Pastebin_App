# Deploy Pastebin on AWS EC2 (permanent, ~$5–15/mo)

Runs the app + Postgres + Redis + free HTTPS (Cloudflare tunnel) on a single always-on
EC2 instance. **Paste content lives in S3** (`BLOB_BACKEND=s3`) — the metadata/blob split,
in production. Only paste *metadata* sits in the on-instance Postgres.

```
        ┌────────────── EC2 (t3.small, AL2023) ──────────────┐
Client → cloudflared → app ── metadata ──▶ Postgres (container)
 (HTTPS)   (tunnel)     │  ── cache ──────▶ Redis (container)
                        └── content ──────▶ S3  (pastebin-blobs-197002356271-aps1)
                                             ▲ credentials via EC2 instance role (IMDS)
```

## Cost
- **t3.small** (2 GB) ≈ $15/mo, or **t3.micro** (1 GB) ≈ $7.5/mo (tight but works).
- 20 GB disk ≈ $2/mo. S3 is pay-per-use (pennies at this scale). No load balancer / NAT.
- **Stop billing:** terminate the instance (and optionally empty/delete the S3 bucket).

## What's already provisioned (by the deploy)
- **S3 bucket** `pastebin-blobs-197002356271-aps1` — private, encrypted, 90-day lifecycle rule.
- **ECR repo** `pastebin` with the pushed image.
- **IAM instance role** `ec2-pastebin` — `AmazonEC2ContainerRegistryReadOnly` +
  `AmazonSSMManagedInstanceCore` + a bucket-scoped inline S3 policy.

## Launch (CLI — what the automated deploy runs)
```bash
aws ec2 run-instances \
  --image-id <AL2023-ami> --instance-type t3.small \
  --iam-instance-profile Name=ec2-pastebin \
  --security-group-ids <sg> \
  --metadata-options "HttpTokens=required,HttpPutResponseHopLimit=2" \
  --user-data file://user-data.sh \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=pastebin}]'
```
> ⚠️ **IMDSv2 hop limit 2 is required** — the AWS SDK runs *inside a container*, one extra
> network hop from the metadata service. With the default hop limit of 1, S3 credential
> lookups fail. No inbound port is needed (cloudflared is outbound); SSM replaces SSH.

## Launch (console alternative)
1. EC2 → Launch instance. **AMI:** Amazon Linux 2023. **Type:** t3.small.
2. **IAM instance profile:** `ec2-pastebin`.
3. **Advanced → Metadata:** IMDSv2 required, **response hop limit = 2**.
4. **Advanced → User data:** paste [`user-data.sh`](user-data.sh).
5. Security group: no inbound needed (add SSH-from-my-IP only if you want a shell).
6. Launch. It self-deploys in ~3–4 min.

## Get the live URL
Via SSM (no SSH):
```bash
aws ssm send-command --instance-ids <id> \
  --document-name AWS-RunShellCommand \
  --parameters 'commands=["cat /opt/pastebin/LIVE_URL.txt"]'
# then read the command output
```
Or, if you enabled SSH: `ssh ec2-user@<ip> cat /opt/pastebin/LIVE_URL.txt`.

## Operate it
```bash
cd /opt/pastebin
docker compose ps
docker compose logs cloudflared | grep trycloudflare   # current URL
docker compose restart                                  # NOTE: new tunnel URL
bash deploy.sh                                           # redeploy + refresh URL
```

## Redeploy after code changes (one command, no SSH)
```bash
# from the app/ dir — rebuild + push + restart the running box + print the URL:
bash deploy/aws-ec2/redeploy.sh

# already pushed / just want to restart the box with the current image:
bash deploy/aws-ec2/redeploy.sh --no-build
```
`redeploy.sh` drives the instance over **SSM** (no SSH, no open ports): it base64-ships
[`remote-redeploy.sh`](remote-redeploy.sh) to the box, which pulls the latest image,
restarts the app, and republishes the URL to S3. cloudflared is left running, so the
public URL stays the same across app redeploys.

### Just get the current live URL
```bash
aws s3 cp s3://pastebin-blobs-197002356271-aps1/_deploy/LIVE_URL.txt - --region ap-south-1
```

### SSM setup notes (already done, but for the record)
- Your IAM user has `PastebinSSMAccess` (SendCommand / GetCommandInvocation / etc.).
- The AWS public `AWS-RunShellCommand` document is **not available in this account**, so we
  created an account-owned equivalent, **`PastebinRunShell`** (a `Command` doc whose
  `aws:runShellScript` step uses `"runCommand": "{{ commands }}"`). `redeploy.sh` targets it.
- Inline SSM stdout works; the URL is also always readable from S3 (above).

## ⚠️ Notes
- **Tunnel URL changes on cloudflared restart.** Stays stable while the container runs.
  For a fixed URL, use a domain + a Cloudflare named tunnel (or ALB + ACM).
- **Metadata durability:** Postgres runs in a container; its `pgdata` volume survives
  restarts but **not** instance termination — use RDS for durable metadata. **Blob
  content is already durable** (that's what S3 is for).
