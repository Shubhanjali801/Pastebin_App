import express, { type Request, type Response, type NextFunction } from "express";
import { config } from "./config";
import { homeRouter } from "./routes/home";
import { pastesRouter } from "./routes/pastes";
import { usersRouter } from "./routes/users";
import { viewRouter } from "./routes/view";
import { PasteError } from "./errors";

// Builds the Express app WITHOUT starting a listener, so tests can import it.
export function createApp() {
  const app = express();

  // We sit behind a load balancer / proxy in the design; trust it for req.ip.
  app.set("trust proxy", true);

  // Body limit must comfortably exceed the raw size cap: JSON-escaping a 10 MB paste
  // can inflate it. The exact byte cap (-> 413) is enforced in the create route; a body
  // over THIS limit throws entity.too.large, which the error handler also maps to 413.
  app.use(express.json({ limit: config.maxPasteBytes * 2 + 1024 * 1024 }));

  // Health check for load balancers.
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // Landing page + create form.
  app.use("/", homeRouter);

  // API (verbose paths are fine — only the paste URL must be short).
  app.use("/api/v1/pastes", pastesRouter);
  app.use("/api/v1/users", usersRouter);

  // Human/raw views live at the ROOT so paste URLs stay short: paste.ly/aB3xK9
  app.use("/", viewRouter);

  // 404 for anything else.
  app.use((_req, res) => res.status(404).json({ error: "Not Found" }));

  // Central error handler: map domain + parser errors to HTTP status codes.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof PasteError) {
      return res.status(err.status).json({ error: err.message });
    }
    // express.json rejects oversized/invalid bodies with a typed error.
    const e = err as { type?: string; status?: number };
    if (e?.type === "entity.too.large" || e?.status === 413) {
      return res.status(413).json({ error: "Payload Too Large" });
    }
    if (e?.type === "entity.parse.failed" || e?.status === 400) {
      return res.status(400).json({ error: "Bad Request", details: ["invalid JSON body"] });
    }
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  });

  return app;
}
