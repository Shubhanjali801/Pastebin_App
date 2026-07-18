import { randomInt } from "node:crypto";

// Base62 alphabet — same "unique short key" idea carried over from the URL shortener.
// Keys are generated RANDOMLY (not from a sequential counter) so pastes are
// hard-to-guess (F3): you can't enumerate other people's unlisted pastes.
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function generateKey(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}
