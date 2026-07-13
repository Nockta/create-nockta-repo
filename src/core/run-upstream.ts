import { spawn } from "node:child_process";
import type { StdioOptions } from "node:child_process";

/**
 * Structured outcome of running an upstream scaffolder command. Returned on
 * success; also carried inside {@link UpstreamFailure} on failure so callers
 * never have to parse a message string to find out what happened (spec §5.9
 * machine interface).
 */
export type UpstreamResult = {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  command: string;
  args: string[];
  durationMs: number;
};

/**
 * Thrown by {@link runUpstream} on any non-success outcome — non-zero exit,
 * killed by signal, or the command failing to even launch (e.g. ENOENT).
 * The triggering `child_process` error, if any, is attached via the
 * standard `Error` `cause` chain rather than folded into {@link UpstreamResult},
 * which stays a plain, JSON-serializable shape.
 */
export class UpstreamFailure extends Error {
  readonly result: UpstreamResult;

  constructor(result: UpstreamResult, cause?: unknown) {
    const commandLine = [result.command, ...result.args].join(" ");
    const outcome =
      result.signal !== null
        ? `killed by signal ${result.signal}`
        : `exited with code ${result.exitCode ?? "unknown"}`;
    super(`Upstream command failed: ${commandLine} (${outcome})`, cause !== undefined ? { cause } : undefined);
    this.name = "UpstreamFailure";
    this.result = result;
  }
}

export type RunUpstreamOptions = {
  command: string;
  /** Positional/flag args, always passed as an array — never shell-interpolated. */
  args: string[];
  /** Working directory the child process spawns in. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * Defaults to `"inherit"` — Shopify's scaffolders are interactive (spec
   * §18.5) and even the non-interactive ones (create-next-app, create-vite,
   * @nestjs/cli) may prompt when passthrough args under-specify options, so
   * every upstream scaffolder gets a real TTY passthrough uniformly rather
   * than branching per `interactiveStdio`. Override only for tests that need
   * to capture output programmatically instead of relaying it to the user's
   * terminal.
   *
   * Accepts a full `StdioOptions` array too (D36 / PART A): the web-submit
   * path passes `["ignore", "inherit", "inherit"]` so a browser-driven run
   * NEVER depends on the launching terminal's stdin (upstream can't block on a
   * prompt), while its normal output still relays to the terminal as the run
   * log. See `commands/create.ts::upstreamStdio()`.
   */
  stdio?: StdioOptions;
  /**
   * When true, short-circuits before ever calling `spawn` — returns a
   * synthetic success result immediately. Belt-and-suspenders: the `create`
   * command's own dry-run branch (spec §5.7) already never calls
   * `runUpstream` at all, but this keeps the runner itself provably inert
   * under `dryRun` for any other caller.
   */
  dryRun?: boolean;
  /**
   * Set when the caller is driving this scaffolder HEADLESSLY — no human is
   * watching the inherited stdio to answer an interactive prompt, even
   * though `stdio` is still `"inherit"` (spec §18.5's uniform TTY
   * passthrough, unchanged). Concretely: `commands/create.ts` passes this
   * whenever `cliOptions.yes` is true — the CLI `--yes` flag path AND the
   * `--web` submit path (`web/run-create-web.ts::answersToCliOptions()`
   * always sets `yes: true`), since a browser-submitted request has no one
   * at the spawning process's terminal either. The wizard path (no `--yes`)
   * never sets this — `commands/create-entry.ts` only ever reaches the
   * wizard when `isTTY` is real (its own gate), so that path is genuinely
   * interactive and must NOT have CI forced on it (Shopify's scaffolders
   * expect to prompt a real human there, spec §18.5).
   *
   * When true, merges `CI: "true"` onto the child's env (itself merged from
   * `process.env`, nothing dropped) UNLESS the caller's own environment
   * already has a truthy `CI` — never clobbers an explicit user setting.
   * This is the fix for the verified headless-scaffolder bug: upstream
   * scaffolders (create-next-app, etc.) print their interactive prompt and
   * exit 0 writing nothing when spawned non-interactively without `CI` set;
   * `CI=true` makes them run their non-interactive default-answers path
   * instead (verified against bare `npx create-next-app@latest`: non-TTY +
   * no `CI` -> no files; `CI=true` -> scaffolds correctly).
   */
  forceCI?: boolean;
};

/** True when an existing `CI` env value should be treated as "already set" and left alone — anything but unset/empty/"false"/"0". */
function isCiEnvAlreadySet(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "false" && normalized !== "0";
}

/**
 * Runs one upstream scaffolder command (spec §10 `core/run-upstream.ts`,
 * §19 Milestone 3). Thin wrapper over `node:child_process.spawn` —
 * `shell: false` always, args passed as an array, never a shell string
 * (no shell interpolation of user-controlled passthrough args).
 *
 * Resolves with a {@link UpstreamResult} on success (`exitCode === 0`,
 * no signal); rejects with {@link UpstreamFailure} on anything else,
 * including the command failing to launch at all.
 */
export async function runUpstream(options: RunUpstreamOptions): Promise<UpstreamResult> {
  const { command, args, cwd } = options;
  const stdio = options.stdio ?? "inherit";
  const start = Date.now();

  if (options.dryRun) {
    return {
      ok: true,
      exitCode: 0,
      signal: null,
      command,
      args,
      durationMs: 0,
    };
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options.forceCI && !isCiEnvAlreadySet(env.CI)) {
    env.CI = "true";
  }

  return new Promise<UpstreamResult>((resolve, reject) => {
    let settled = false;

    const child = spawn(command, args, {
      cwd,
      stdio,
      shell: false,
      env,
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      const result: UpstreamResult = {
        ok: false,
        exitCode: null,
        signal: null,
        command,
        args,
        durationMs: Date.now() - start,
      };
      reject(new UpstreamFailure(result, error));
    });

    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      const result: UpstreamResult = {
        ok: exitCode === 0 && signal === null,
        exitCode,
        signal,
        command,
        args,
        durationMs: Date.now() - start,
      };
      if (result.ok) {
        resolve(result);
      } else {
        reject(new UpstreamFailure(result));
      }
    });
  });
}
