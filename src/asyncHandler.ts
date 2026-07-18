import type { Request, Response, NextFunction, RequestHandler } from "express";

// Express 4 doesn't forward rejected promises to the error middleware on its own.
// This wrapper does, so route handlers can be plain async functions.
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
