import { describe, expect, it } from "vitest";
import { buildUpstreamOptionArgs, upstreamOptionDefaults } from "../src/scaffolders/upstream-options.js";
import type { UpstreamOption } from "../src/types/scaffold.js";

const OPTS: UpstreamOption[] = [
  { key: "b", label: "B", description: "", kind: "boolean", default: true, flag: "--b", negatedFlag: "--no-b" },
  { key: "bare", label: "Bare", description: "", kind: "boolean", default: false, flag: "--bare" },
  {
    key: "c",
    label: "C",
    description: "",
    kind: "choice",
    default: "x",
    flag: "--c",
    choices: [
      { value: "x", label: "X" },
      { value: "y", label: "Y" },
    ],
  },
  { key: "t", label: "T", description: "", kind: "text", default: "def", flag: "--t" },
];

describe("buildUpstreamOptionArgs (D36)", () => {
  it("returns [] when there are no answers (bare buildCommand path)", () => {
    expect(buildUpstreamOptionArgs(OPTS, undefined)).toEqual([]);
  });

  it("emits nothing for keys not present in the answers object", () => {
    expect(buildUpstreamOptionArgs(OPTS, { b: true })).toEqual(["--b"]);
  });

  it("boolean true/false map to flag/negatedFlag", () => {
    expect(buildUpstreamOptionArgs(OPTS, { b: true })).toEqual(["--b"]);
    expect(buildUpstreamOptionArgs(OPTS, { b: false })).toEqual(["--no-b"]);
  });

  it("boolean with no negatedFlag emits nothing when false", () => {
    expect(buildUpstreamOptionArgs(OPTS, { bare: false })).toEqual([]);
    expect(buildUpstreamOptionArgs(OPTS, { bare: true })).toEqual(["--bare"]);
  });

  it('accepts stringified booleans ("true"/"false") from a JSON payload', () => {
    expect(buildUpstreamOptionArgs(OPTS, { b: "true" })).toEqual(["--b"]);
    expect(buildUpstreamOptionArgs(OPTS, { b: "false" })).toEqual(["--no-b"]);
  });

  it("choice/text emit [flag, value] as two tokens", () => {
    expect(buildUpstreamOptionArgs(OPTS, { c: "y", t: "hello" })).toEqual(["--c", "y", "--t", "hello"]);
  });

  it("empty string / null values emit nothing", () => {
    expect(buildUpstreamOptionArgs(OPTS, { t: "", c: null })).toEqual([]);
  });

  it("preserves option order regardless of answer key order", () => {
    expect(buildUpstreamOptionArgs(OPTS, { t: "z", c: "y", bare: true, b: false })).toEqual([
      "--no-b",
      "--bare",
      "--c",
      "y",
      "--t",
      "z",
    ]);
  });
});

describe("upstreamOptionDefaults (D36)", () => {
  it("returns each option's default keyed by key", () => {
    expect(upstreamOptionDefaults(OPTS)).toEqual({ b: true, bare: false, c: "x", t: "def" });
  });

  it("empty/undefined option list -> {}", () => {
    expect(upstreamOptionDefaults([])).toEqual({});
    expect(upstreamOptionDefaults(undefined)).toEqual({});
  });

  it("feeding defaults back through buildUpstreamOptionArgs is a full, explicit, non-interactive argv", () => {
    expect(buildUpstreamOptionArgs(OPTS, upstreamOptionDefaults(OPTS))).toEqual(["--b", "--c", "x", "--t", "def"]);
  });
});
