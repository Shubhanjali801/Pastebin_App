import { z } from "zod";
import { EXPIRY_OPTIONS } from "./expiry";

// Request schema for POST /api/v1/pastes (matches 02_HLD/02_api_design.md).
// NOTE: the hard 10 MB size cap is enforced on the raw BYTE length in the route
// (returning 413), not here — zod's string length counts UTF-16 code units, which
// isn't the same as the byte budget we actually care about.
export const createPasteSchema = z.object({
  content: z.string().min(1, "content must not be empty"),

  // Optional language hint for client-side syntax highlighting (F8).
  language: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9+#._-]{1,32}$/, "language must be 1-32 chars of [A-Za-z0-9+#._-]")
    .optional(),

  // Expiry (F5): never | 10m | 1h | 1d | 1w | burn.
  expiry: z.enum(EXPIRY_OPTIONS).default("never"),

  // Visibility (F6): public | unlisted | private.
  visibility: z.enum(["public", "unlisted", "private"]).default("unlisted"),

  // Custom alias (F7): Base62 plus - and _, 3-32 chars.
  custom_alias: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{3,32}$/, "custom_alias must be 3-32 chars of [A-Za-z0-9_-]")
    .optional(),
});

export type CreatePasteInput = z.infer<typeof createPasteSchema>;
