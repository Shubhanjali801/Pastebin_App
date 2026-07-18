import type { Request } from "express";

// Minimal auth for the study project (F9). Real deployments verify a signed JWT and
// derive the user id from its claims; here we treat the bearer token AS the owner id
// so the ownership/visibility logic (F6) can be exercised end-to-end without a full
// identity service. Anonymous requests (no header) get a null owner.
export function ownerFromReq(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}
