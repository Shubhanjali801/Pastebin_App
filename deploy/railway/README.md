# Deploy Pastebin on Railway

A permanent, free-HTTPS home for the app (nice for a portfolio — the URL never changes,
unlike the Cloudflare tunnel). Railway hosts three things in one project:

```
  ┌─ app (this Dockerfile) ── metadata ─▶ Postgres  (Railway plugin)
  │                          ── cache ───▶ Redis     (Railway plugin)
  └──────────────────────── content ────▶ /app/data/blobs  (Railway volume)
```

Blobs use the **local file store on a persistent volume** (no AWS). To use S3 instead,
set `BLOB_BACKEND=s3` + `S3_BUCKET` + `AWS_REGION` + `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`.

---

## One-time setup

```bash
npm i -g @railway/cli     # install the CLI
railway login             # opens a browser to authenticate (only you can do this)
```

## Deploy (from the `app/` folder)

```bash
cd System_Design/Pastebin_Implementation/app

# 1) create a project and link this folder to it
railway init

# 2) add the managed datastores (or add them in the dashboard)
railway add --database postgres
railway add --database redis

# 3) set the app's environment variables (see the table below)
railway variables --set "BLOB_BACKEND=local" \
                  --set "BLOB_DIR=/app/data/blobs" \
                  --set "BASE_URL=https://\${{RAILWAY_PUBLIC_DOMAIN}}" \
                  --set "DATABASE_URL=\${{Postgres.DATABASE_URL}}" \
                  --set "REDIS_URL=\${{Redis.REDIS_URL}}"

# 4) add a persistent volume for the blobs, mounted at /app/data
#    (CLI: `railway volume add -m /app/data`  — or Dashboard → service → Variables/Volumes)

# 5) deploy the current code
railway up

# 6) give it a public URL
railway domain
```

Open the URL it prints — that's your permanent Pastebin. 🎉

---

## Environment variables

| Variable | Value | Why |
|----------|-------|-----|
| `PORT` | *(auto-injected by Railway)* | the app listens on it |
| `BASE_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` | builds the returned paste URLs |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | metadata store (reference the Postgres plugin) |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | cache + view counters (reference the Redis plugin) |
| `BLOB_BACKEND` | `local` | use the file blob store |
| `BLOB_DIR` | `/app/data/blobs` | must sit under the mounted volume path |

> `${{Postgres.DATABASE_URL}}` / `${{Redis.REDIS_URL}}` are Railway **reference variables** —
> match the exact service names shown in your project (they may be `Postgres`/`Redis`).

---

## How it builds & runs
- Railway builds the repo's [`Dockerfile`](../../Dockerfile) (multi-stage: `tsc` → slim runtime).
- On start it runs `npx prisma migrate deploy` (applies the schema) then `node dist/index.js`
  — configured in [`railway.json`](../../railway.json), with a `/health` healthcheck.
- The Prisma client is built with the Alpine (`linux-musl-openssl-3.0.x`) engine target, so it
  runs in the `node:22-alpine` image Railway builds.

## Notes
- **Volume durability:** blobs persist across deploys/restarts on the Railway volume. (For
  11-nines durability + CDN, switch `BLOB_BACKEND=s3` — the code already supports it.)
- **Cost:** the app + Postgres + Redis run within Railway's usage-based pricing; a small
  project like this is cheap, but check your plan's limits.
- **Redeploy after code changes:** just `railway up` again (or connect the GitHub repo for
  auto-deploys on push).
