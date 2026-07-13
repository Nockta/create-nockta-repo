import { describe, expect, it } from "vitest";
import { program } from "../src/cli.js";

describe("CLI wiring (Milestone 1 skeleton)", () => {
  it("registers the create and list subcommands", () => {
    const subcommandNames = program.commands.map((cmd) => cmd.name());
    expect(subcommandNames).toContain("create");
    expect(subcommandNames).toContain("list");
    expect(subcommandNames).toContain("wizard");
  });

  it("registers the global --json flag", () => {
    const jsonOption = program.options.find((opt) => opt.long === "--json");
    expect(jsonOption).toBeDefined();
  });

  it("registers the global --skills-version flag", () => {
    const skillsVersionOption = program.options.find((opt) => opt.long === "--skills-version");
    expect(skillsVersionOption).toBeDefined();
  });

  it("help output mentions create and list", () => {
    const help = program.helpInformation();
    expect(help).toContain("create");
    expect(help).toContain("list");
    expect(help).toContain("--json");
    expect(help).toContain("--skills-version");
  });
});
