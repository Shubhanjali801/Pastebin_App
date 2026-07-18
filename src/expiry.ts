// Expiry option -> seconds-from-now (03_LLD/03_sample_code/pastebin.py _EXPIRY_MAP).
// "never" and "burn" have no time-based expiry: "never" lives forever; "burn" is
// destroyed on first read (burn_after_read), handled by the service, not a TTL.
export const EXPIRY_OPTIONS = ["never", "10m", "1h", "1d", "1w", "burn"] as const;
export type ExpiryOption = (typeof EXPIRY_OPTIONS)[number];

const SECONDS: Record<ExpiryOption, number | null> = {
  never: null,
  "10m": 10 * 60,
  "1h": 60 * 60,
  "1d": 24 * 60 * 60,
  "1w": 7 * 24 * 60 * 60,
  burn: null,
};

export interface ExpiryResolution {
  expiresAt: Date | null;
  burnAfterRead: boolean;
}

export function resolveExpiry(option: ExpiryOption, now = Date.now()): ExpiryResolution {
  const seconds = SECONDS[option];
  return {
    expiresAt: seconds ? new Date(now + seconds * 1000) : null,
    burnAfterRead: option === "burn",
  };
}
