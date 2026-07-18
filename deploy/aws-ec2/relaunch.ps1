<#
.SYNOPSIS
  Launch a fresh Pastebin EC2 instance in ap-south-1 after a terminate.

.DESCRIPTION
  Finds the latest Amazon Linux 2023 AMI, launches a t3.small with the ec2-pastebin
  instance profile + the pastebin security group + IMDSv2 hop-limit 2 + user-data,
  waits for it to self-deploy, prints the live Cloudflare URL, and rewrites the
  INSTANCE id in redeploy.sh so future redeploys target the new box.

  Reuses the existing S3 bucket, ECR image, IAM role, and security group — only the
  instance is recreated. Run it from anywhere; paths are resolved from the script dir.

.EXAMPLE
  ./relaunch.ps1
  ./relaunch.ps1 -Force     # launch even if a pastebin instance already exists
#>
param([switch]$Force)

$ErrorActionPreference = 'Stop'

# --- config (ap-south-1 / Mumbai) ---
$Region       = 'ap-south-1'
$InstanceType = 't3.small'
$Profile      = 'ec2-pastebin'                       # IAM instance profile
$Sg           = 'sg-05748cd6b5e66bdfc'               # pastebin-sg (outbound only)
$Bucket       = 'pastebin-blobs-197002356271-aps1'   # blob + LIVE_URL bucket
$Here         = $PSScriptRoot
$UserDataUri  = 'file://' + ((Join-Path $Here 'user-data.sh') -replace '\\', '/')
$RedeployFile = Join-Path $Here 'redeploy.sh'

function Fail($msg) { Write-Error $msg; exit 1 }

# --- guard: don't silently create a duplicate (double billing) ---
$existing = (aws ec2 describe-instances --region $Region `
    --filters "Name=tag:Name,Values=pastebin" "Name=instance-state-name,Values=pending,running,stopping,stopped" `
    --query 'Reservations[].Instances[].InstanceId' --output text | Out-String).Trim()
if ($existing -and -not $Force) {
  Write-Warning "A pastebin instance already exists in ${Region}: $existing"
  Write-Host "  - Resume it:            aws ec2 start-instances --region $Region --instance-ids $existing"
  Write-Host "  - Launch anyway:        re-run this script with -Force"
  return
}

# --- resolve the newest AL2023 x86_64 AMI ---
Write-Host '==> Finding latest Amazon Linux 2023 AMI...'
$Ami = (aws ec2 describe-images --region $Region --owners amazon `
    --filters "Name=name,Values=al2023-ami-2023.*-kernel-6.1-x86_64" "Name=state,Values=available" `
    --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text | Out-String).Trim()
if (-not $Ami -or $Ami -notlike 'ami-*') { Fail "Could not resolve an AMI (got '$Ami')" }
Write-Host "    AMI: $Ami"

# --- launch ---
Write-Host '==> Launching instance...'
# CLI shorthand (no double quotes) — avoids PowerShell stripping quotes from JSON args.
$bdm = 'DeviceName=/dev/xvda,Ebs={VolumeSize=20,VolumeType=gp3,DeleteOnTermination=true}'
$Iid = (aws ec2 run-instances --region $Region `
    --image-id $Ami --instance-type $InstanceType `
    --iam-instance-profile "Name=$Profile" `
    --security-group-ids $Sg `
    --metadata-options "HttpTokens=required,HttpPutResponseHopLimit=2,HttpEndpoint=enabled" `
    --block-device-mappings $bdm `
    --user-data $UserDataUri `
    --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=pastebin}]' `
    --query 'Instances[0].InstanceId' --output text | Out-String).Trim()
if (-not $Iid -or $Iid -notlike 'i-*') { Fail "Launch failed (got '$Iid')" }
Write-Host "    Instance: $Iid"

Write-Host '==> Waiting for it to reach running...'
aws ec2 wait instance-running --region $Region --instance-ids $Iid

# --- point redeploy.sh at the new instance ---
if (Test-Path $RedeployFile) {
  $content = Get-Content $RedeployFile -Raw
  $content = [regex]::Replace($content, 'INSTANCE="i-[0-9a-f]+"', "INSTANCE=`"$Iid`"")
  Set-Content -Path $RedeployFile -Value $content -NoNewline
  Write-Host "    Updated redeploy.sh -> INSTANCE=$Iid"
}

# S3 "not found yet" is expected while the box boots, so relax error handling here —
# otherwise the expected 404 stderr becomes a fatal NativeCommandError under -Stop.
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'

# --- clear the stale URL marker so we only read the NEW instance's tunnel URL ---
aws s3 rm "s3://$Bucket/_deploy/LIVE_URL.txt" --region $Region 2>&1 | Out-Null

Write-Host '==> Waiting for self-deploy + live URL (~2-3 min)...'
$Url = ''
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 10
  $out = (aws s3 cp "s3://$Bucket/_deploy/LIVE_URL.txt" - --region $Region 2>&1 | Out-String)
  if ($out -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $Url = $Matches[0]; break }
}
$ErrorActionPreference = $prevEAP
if (-not $Url) {
  Write-Warning "Timed out waiting for the URL. Check later with:"
  Write-Host "  aws s3 cp s3://$Bucket/_deploy/LIVE_URL.txt - --region $Region"
  return
}

# --- optional health check ---
$health = '(not reachable yet)'
try { $health = (Invoke-RestMethod "$Url/health" -TimeoutSec 20).status } catch {}

Write-Host ''
Write-Host '=================================================='
Write-Host "  LIVE:      $Url"
Write-Host "  instance:  $Iid  ($Region)"
Write-Host "  health:    $health"
Write-Host '=================================================='
Write-Host ''
Write-Host "Stop later:      aws ec2 stop-instances --region $Region --instance-ids $Iid"
Write-Host "Terminate:       aws ec2 terminate-instances --region $Region --instance-ids $Iid"
