import { Router } from "express";
import { pasteService } from "../pasteService";
import { asyncHandler } from "../asyncHandler";
import { ownerFromReq } from "../auth";
import { config } from "../config";

export const viewRouter = Router();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Raw text view (like pastebin's /raw) — what tools `curl`. GET /{key}/raw
viewRouter.get(
  "/:key/raw",
  asyncHandler(async (req, res) => {
    const { content } = await pasteService.read(req.params.key, ownerFromReq(req));
    res.type("text/plain; charset=utf-8").send(content);
  }),
);

// Rendered view for humans in a browser. GET /{key}
viewRouter.get(
  "/:key",
  asyncHandler(async (req, res) => {
    const { meta, content } = await pasteService.read(req.params.key, ownerFromReq(req));
    const rawUrl = `${config.baseUrl.replace(/\/$/, "")}/${meta.key}/raw`;
    const expiry = meta.expiresAt ? meta.expiresAt.toISOString() : "never";
    const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Paste ${escapeHtml(meta.key)}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    .meta { color: #888; font-size: .85rem; margin-bottom: .75rem; display: flex; gap: 1rem; flex-wrap: wrap; }
    pre { background: rgba(127,127,127,.12); padding: 1rem; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
    a { color: #6366f1; }
  </style>
</head>
<body>
  <div class="meta">
    <span>🔑 ${escapeHtml(meta.key)}</span>
    <span>lang: ${escapeHtml(meta.language ?? "—")}</span>
    <span>visibility: ${escapeHtml(meta.visibility)}</span>
    <span>size: ${meta.sizeBytes} B</span>
    <span>views: ${meta.viewCount}</span>
    <span>expires: ${escapeHtml(expiry)}</span>
    <span><a href="${escapeHtml(rawUrl)}">raw</a></span>
  </div>
  <pre>${escapeHtml(content)}</pre>
</body>
</html>`;
    res.type("html").send(page);
  }),
);
