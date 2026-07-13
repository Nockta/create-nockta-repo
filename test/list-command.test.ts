import { afterEach, describe, expect, it, vi } from "vitest";
import { runListCommand } from "../src/commands/list.js";
import { REPO_TYPES } from "../src/types/repo-type.js";

function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((line: string) => {
    lines.push(line);
  });
  return { lines, restore: () => spy.mockRestore() };
}

describe("list --json (spec §5.8, §5.9 machine interface)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints exactly one parseable JSON object with a repoTypes array", async () => {
    const { lines, restore } = captureStdout();
    await runListCommand({ json: true });
    restore();

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(Array.isArray(parsed.repoTypes)).toBe(true);
    expect(parsed.repoTypes).toHaveLength(REPO_TYPES.length);
  });

  it("each entry carries repoType, upstreamTool, conceptualCommand, and a real exampleCommand", async () => {
    const { lines, restore } = captureStdout();
    await runListCommand({ json: true });
    restore();

    const parsed = JSON.parse(lines[0]);
    const repoTypes = parsed.repoTypes.map((entry: { repoType: string }) => entry.repoType);
    expect([...repoTypes].sort()).toEqual([...REPO_TYPES].sort());

    for (const entry of parsed.repoTypes) {
      expect(typeof entry.repoType).toBe("string");
      expect(typeof entry.displayName).toBe("string");
      expect(typeof entry.upstreamTool).toBe("string");
      expect(typeof entry.conceptualCommand).toBe("string");
      expect(typeof entry.interactiveStdio).toBe("boolean");
      expect(typeof entry.provisional).toBe("boolean");
      expect(entry.exampleCommand).toHaveProperty("name");
      expect(entry.exampleCommand).toHaveProperty("command");
      expect(Array.isArray(entry.exampleCommand.args)).toBe(true);
      expect(entry.exampleCommand.args).toContain("<project-path>");
    }
  });

  it("marks shopify-headless provisional and Shopify entries interactive", async () => {
    const { lines, restore } = captureStdout();
    await runListCommand({ json: true });
    restore();

    const parsed = JSON.parse(lines[0]);
    const byType = Object.fromEntries(
      parsed.repoTypes.map((entry: { repoType: string }) => [entry.repoType, entry]),
    );
    expect(byType["shopify-headless"].provisional).toBe(true);
    expect(byType["shopify-app"].interactiveStdio).toBe(true);
    expect(byType["shopify-theme"].interactiveStdio).toBe(true);
    expect(byType["next"].interactiveStdio).toBe(false);
  });

  it("does not invent architecture-preset or skill-pack data", async () => {
    const { lines, restore } = captureStdout();
    await runListCommand({ json: true });
    restore();

    const parsed = JSON.parse(lines[0]);
    expect(parsed).not.toHaveProperty("architecturePresets");
    expect(parsed).not.toHaveProperty("skillPacks");
  });
});

describe("list human output", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists every repo type's conceptual command", async () => {
    const { lines, restore } = captureStdout();
    await runListCommand({});
    restore();

    const output = lines.join("\n");
    for (const repoType of REPO_TYPES) {
      expect(output).toContain(repoType);
    }
    expect(output).toContain("npx create-next-app@latest");
    expect(output).toContain("shopify app init");
  });
});
