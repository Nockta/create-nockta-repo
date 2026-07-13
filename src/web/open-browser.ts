import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

/**
 * Cross-platform default-browser open for `--web` mode (decisions.md D30), no heavy dependency.
 * Pure command selection is factored out (`browserCommand`) so it is unit-testable without
 * spawning anything; `openBrowser` is the thin impure wrapper.
 *
 * If the open fails, the CALLER still prints the URL (see `run-web-install.ts`) — this function
 * never throws, so a missing `xdg-open` on a Linux box just means "you open it yourself".
 */
export interface BrowserCommand {
  cmd: string;
  args: string[];
}

export function browserCommand(url: string, platform: NodeJS.Platform): BrowserCommand {
  if (platform === "darwin") return { cmd: "open", args: [url] };
  if (platform === "win32") return { cmd: "cmd", args: ["/c", "start", "", url] };
  // linux / other unix: xdg-open is the freedesktop standard opener.
  return { cmd: "xdg-open", args: [url] };
}

export type SpawnFn = typeof spawn;

/**
 * Best-effort browser open. Returns `true` when the child was launched without a synchronous
 * throw; an ASYNC launch failure (e.g. `xdg-open` not installed) is swallowed via the child's
 * `error` listener — the return value cannot reflect it, which is exactly why the caller always
 * prints the URL regardless. Detached + unref'd so the CLI can exit without waiting on it.
 */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform, spawnFn: SpawnFn = spawn): boolean {
  const { cmd, args } = browserCommand(url, platform);
  try {
    const child: ChildProcess = spawnFn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      /* swallowed — caller prints the URL as the manual fallback */
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
