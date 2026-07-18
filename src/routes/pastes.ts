import { Router } from "express";
import { config } from "../config";
import { pasteService } from "../pasteService";
import { createPasteSchema } from "../validation";
import { rateLimit } from "../rateLimit";
import { asyncHandler } from "../asyncHandler";
import { ownerFromReq } from "../auth";
import { TooLarge } from "../errors";
import type { Paste } from "@prisma/client";

export const pastesRouter = Router();

function buildUrl(key: string): string {
  return `${config.baseUrl.replace(/\/$/, "")}/${key}`;
}

// F1 + F4 + F5 + F6 + F7 — Create a paste.
// POST /api/v1/pastes
pastesRouter.post(
  "/",
  rateLimit,
  asyncHandler(async (req, res) => {
    const parsed = createPasteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        details: parsed.error.issues.map((i) => i.message),
      });
    }

    const { content, language, expiry, visibility, custom_alias } = parsed.data;

    // F4 — enforce the size cap on RAW BYTES before storing (reject early with 413).
    const bytes = Buffer.from(content, "utf-8");
    if (bytes.length > config.maxPasteBytes) throw TooLarge();

    const paste = await pasteService.create({
      content: bytes,
      language,
      expiry,
      visibility,
      customAlias: custom_alias,
      ownerId: ownerFromReq(req),
    });

    return res.status(201).json({
      key: paste.key,
      url: buildUrl(paste.key),
      expires_at: paste.expiresAt,
    });
  }),
);

// F2 — Read a paste as JSON (API form). GET /api/v1/pastes/{key}
pastesRouter.get(
  "/:key",
  asyncHandler(async (req, res) => {
    const { meta, content } = await pasteService.read(req.params.key, ownerFromReq(req));
    return res.json(serialize(meta, content));
  }),
);

// DELETE /api/v1/pastes/{key} — owner only -> 204.
pastesRouter.delete(
  "/:key",
  asyncHandler(async (req, res) => {
    await pasteService.delete(req.params.key, ownerFromReq(req));
    return res.status(204).end();
  }),
);

// Shape a metadata row + content into the API response from 02_HLD/02_api_design.md.
function serialize(meta: Paste, content: string) {
  return {
    key: meta.key,
    content,
    language: meta.language,
    visibility: meta.visibility,
    size_bytes: meta.sizeBytes,
    created_at: meta.createdAt,
    expires_at: meta.expiresAt,
    views: meta.viewCount,
  };
}
