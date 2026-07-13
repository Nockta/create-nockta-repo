import { createServer } from "node:http";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { renderCreateWebPage } from "./page.js";
import { fetchInjectSchema } from "./inject-schema.js";
import type { InjectWizardSchema } from "./inject-schema.js";
import type { WebProjectSchema } from "./project-schema.js";
import type { CreateWebAnswers, CreateWebSubmitResult } from "./run-create-web.js";

/**
 * create's `--web` HTTP server (decisions.md D30) — mirrors inject's `src/web/server.ts` security
 * posture EXACTLY: binds ONLY `127.0.0.1`; `listen(0)` for an OS-assigned random port; a one-time
 * crypto token in the URL that EVERY request must present (403 otherwise); a hard POST body cap.
 *
 * Three endpoints:
 *   - `GET /`              → the two-section page (Project + Skills), token + schemas embedded.
 *   - `GET /inject-schema` → SPAWN `inject wizard --emit-schema --type <types> [--adapters <csv>]`
 *                            (the reactive Skills-section source; honors the test-override + version).
 *   - `POST /submit`       → validate token, receive the full answers, run create's REAL pipeline
 *                            (scaffold + overlay + headless inject with skill deltas), respond with
 *                            the result, then resolve `waitForResult()`. One submit only.
 */
export interface CreateWebServerHandle {
  url: string;
  port: number;
  token: string;
  /** Resolves with the pipeline result on the first successful POST; rejects if closed before then. */
  waitForResult(): Promise<CreateWebSubmitResult>;
  close(): Promise<void>;
}

export interface StartCreateWebServerOptions {
  project: WebProjectSchema;
  initialSkills: InjectWizardSchema;
  /** Pins the emit-schema spawn's `@<version>` (same value the install spawn uses). */
  skillsVersion?: string;
  /** Where create scaffolds / spawns inject — threaded onto the pipeline runner, not the server itself. */
  cwd?: string;
  host?: string;
  renderPage?: (project: WebProjectSchema, skills: InjectWizardSchema, token: string) => string;
  /** Runs create's real pipeline for the submitted answers and returns a structured result. */
  runPipeline: (answers: CreateWebAnswers) => Promise<CreateWebSubmitResult>;
}

/** Hard cap on a POST body so a malformed/hostile client can't exhaust memory (mirrors inject). */
const MAX_BODY_BYTES = 1_000_000;

export function startCreateWebServer(opts: StartCreateWebServerOptions): Promise<CreateWebServerHandle> {
  const host = opts.host ?? "127.0.0.1";
  const token = randomBytes(24).toString("hex");
  const render = opts.renderPage ?? renderCreateWebPage;
  const html = render(opts.project, opts.initialSkills, token);

  let resolveResult!: (r: CreateWebSubmitResult) => void;
  let rejectResult!: (e: Error) => void;
  const resultPromise = new Promise<CreateWebSubmitResult>((res, rej) => {
    resolveResult = res;
    rejectResult = rej;
  });
  resultPromise.catch(() => {});
  let settled = false;

  const server: Server = createServer((req, res) => {
    const parsedUrl = new URL(req.url ?? "/", `http://${host}`);
    const providedToken = parsedUrl.searchParams.get("t");

    if (req.method === "GET" && parsedUrl.pathname === "/") {
      if (providedToken !== token) {
        res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    // Reactive Skills-section source (decisions.md D30 composition contract). The page fetches this on
    // every repo-type/also-types/adapter toggle so the offering tracks the Project section's state.
    // Same token gate. Empty `types` → inject-schema's empty-skills marker (no spawn — see
    // `inject-schema.ts`), which the page renders as the "pick a project type" placeholder.
    if (req.method === "GET" && parsedUrl.pathname === "/inject-schema") {
      if (providedToken !== token) {
        res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return;
      }
      const types = parsedUrl.searchParams.get("types") ?? "";
      const adapters = parsedUrl.searchParams.get("adapters") ?? "";
      fetchInjectSchema({ types, adapters, skillsVersion: opts.skillsVersion })
        .then((schema) => {
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(schema));
        })
        .catch((error: Error) => {
          res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: error.message }));
        });
      return;
    }

    if (req.method === "POST" && parsedUrl.pathname === "/submit") {
      let body = "";
      let aborted = false;
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
        if (body.length > MAX_BODY_BYTES) {
          aborted = true;
          res.writeHead(413, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "payload too large" }));
          req.destroy();
        }
      });
      req.on("end", () => {
        if (aborted) return;
        let parsed: { token?: string; answers?: CreateWebAnswers } | null = null;
        try {
          parsed = JSON.parse(body) as { token?: string; answers?: CreateWebAnswers };
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid JSON body" }));
          return;
        }
        const bodyToken = providedToken ?? parsed?.token;
        if (bodyToken !== token) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "forbidden" }));
          return;
        }
        if (settled) {
          // One submit only — a second POST is ignored (the first is already running/ran).
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "already submitted" }));
          return;
        }
        settled = true;
        const answers = (parsed?.answers ?? {}) as CreateWebAnswers;
        opts
          .runPipeline(answers)
          .then((result) => {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: result.ok, result }));
            resolveResult(result);
          })
          .catch((error: Error) => {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: error.message }));
            rejectResult(error);
          });
      });
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  return new Promise<CreateWebServerHandle>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      const addr = server.address() as AddressInfo;
      const port = addr.port;
      const url = `http://${host}:${port}/?t=${token}`;
      resolve({
        url,
        port,
        token,
        waitForResult: () => resultPromise,
        close: () =>
          new Promise<void>((done) => {
            if (!settled) {
              settled = true;
              rejectResult(new Error("server closed before the browser submitted"));
            }
            server.close(() => done());
          }),
      });
    });
  });
}
