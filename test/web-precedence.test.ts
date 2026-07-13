import { describe, expect, it } from "vitest";
import { resolveWebPrecedence } from "../src/web/precedence.js";
import { detectDisplay } from "../src/web/display.js";
import { browserCommand, openBrowser } from "../src/web/open-browser.js";

/**
 * Unit coverage for create's D30 web precedence resolver (copied verbatim from inject — same
 * branches, same guarantees), the display heuristic, and the browser-open command mapping. All pure.
 */
describe("resolveWebPrecedence — create (decisions.md D30)", () => {
  it("web + display -> web (authoritative even with --yes; --yes only pre-seeds)", () => {
    expect(resolveWebPrecedence({ web: true, yes: false, hasDisplay: true, isTTY: true }).mode).toBe("web");
    expect(resolveWebPrecedence({ web: true, yes: true, hasDisplay: true, isTTY: false }).mode).toBe("web");
  });

  it("web + headless + --yes -> cli (falls back to the non-interactive --yes create)", () => {
    const d = resolveWebPrecedence({ web: true, yes: true, hasDisplay: false, isTTY: false });
    expect(d.mode).toBe("cli");
    expect(d.reason).toMatch(/--yes/);
  });

  it("web + headless + TTY (no --yes) -> cli (falls back to the terminal wizard)", () => {
    const d = resolveWebPrecedence({ web: true, yes: false, hasDisplay: false, isTTY: true });
    expect(d.mode).toBe("cli");
    expect(d.reason).toMatch(/wizard/);
  });

  it("web + headless + no TTY + no --yes -> clean error (never a hang)", () => {
    const d = resolveWebPrecedence({ web: true, yes: false, hasDisplay: false, isTTY: false });
    expect(d.mode).toBe("error");
    expect(d.reason).toMatch(/nothing to do/);
  });

  it("no web (default / --cli) -> cli, regardless of display/TTY/--yes", () => {
    expect(resolveWebPrecedence({ web: false, yes: false, hasDisplay: true, isTTY: true }).mode).toBe("cli");
    expect(resolveWebPrecedence({ web: false, yes: true, hasDisplay: false, isTTY: false }).mode).toBe("cli");
  });
});

describe("detectDisplay heuristic (decisions.md D30)", () => {
  it("macOS and Windows always assume a display", () => {
    expect(detectDisplay({}, "darwin")).toBe(true);
    expect(detectDisplay({}, "win32")).toBe(true);
  });
  it("linux requires DISPLAY or WAYLAND_DISPLAY", () => {
    expect(detectDisplay({}, "linux")).toBe(false);
    expect(detectDisplay({ DISPLAY: ":0" }, "linux")).toBe(true);
    expect(detectDisplay({ WAYLAND_DISPLAY: "wayland-0" }, "linux")).toBe(true);
  });
});

describe("browserCommand mapping (decisions.md D30)", () => {
  it("uses the platform-native opener", () => {
    expect(browserCommand("http://x", "darwin")).toEqual({ cmd: "open", args: ["http://x"] });
    expect(browserCommand("http://x", "win32")).toEqual({ cmd: "cmd", args: ["/c", "start", "", "http://x"] });
    expect(browserCommand("http://x", "linux")).toEqual({ cmd: "xdg-open", args: ["http://x"] });
  });
  it("openBrowser never throws and returns true when the spawner launches", () => {
    let called: { cmd: string; args: string[] } | null = null;
    const fakeSpawn = ((cmd: string, args: string[]) => {
      called = { cmd, args };
      return { on() {}, unref() {} } as unknown as ReturnType<typeof import("node:child_process").spawn>;
    }) as unknown as typeof import("node:child_process").spawn;
    expect(openBrowser("http://x", "linux", fakeSpawn)).toBe(true);
    expect(called).toEqual({ cmd: "xdg-open", args: ["http://x"] });
  });
});
