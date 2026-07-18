import { Router } from "express";
import { config } from "../config";
import { pasteService } from "../pasteService";
import { asyncHandler } from "../asyncHandler";
import { ownerFromReq } from "../auth";

export const usersRouter = Router();

// F9 — list the authenticated user's pastes. GET /api/v1/users/me/pastes
usersRouter.get(
  "/me/pastes",
  asyncHandler(async (req, res) => {
    const owner = ownerFromReq(req);
    if (!owner) return res.status(401).json({ error: "Unauthorized" });

    const rows = await pasteService.listByOwner(owner);
    return res.json({
      pastes: rows.map((p) => ({
        key: p.key,
        url: `${config.baseUrl.replace(/\/$/, "")}/${p.key}`,
        language: p.language,
        visibility: p.visibility,
        size_bytes: p.sizeBytes,
        created_at: p.createdAt,
        expires_at: p.expiresAt,
        views: p.viewCount,
      })),
    });
  }),
);
