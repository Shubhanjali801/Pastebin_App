// Domain errors carry the HTTP status the route should emit, so PasteService stays
// framework-agnostic and routes stay thin (just map error -> response).
export class PasteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PasteError";
  }
}

export const NotFound = () => new PasteError(404, "Not Found");
export const Gone = () => new PasteError(410, "Gone"); // expired or already burned
export const Forbidden = () => new PasteError(403, "Forbidden"); // private, not owner
export const AliasTaken = () => new PasteError(409, "custom_alias already taken");
export const TooLarge = () => new PasteError(413, "Payload Too Large"); // over size cap
