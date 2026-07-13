import { describe, expect, it } from "vitest";
import { extractPassthroughArgs } from "../src/cli.js";

describe("extractPassthroughArgs (spec §5.4 pass-through args)", () => {
  it("returns everything after the first literal --", () => {
    expect(
      extractPassthroughArgs(["node", "cli.js", "create", "apps/web", "--type", "next", "--", "--tailwind", "--eslint"]),
    ).toEqual(["--tailwind", "--eslint"]);
  });

  it("returns an empty array when there is no --", () => {
    expect(extractPassthroughArgs(["node", "cli.js", "create", "apps/web", "--type", "next"])).toEqual([]);
  });

  it("returns an empty array when -- is the last token", () => {
    expect(extractPassthroughArgs(["node", "cli.js", "create", "apps/web", "--type", "next", "--"])).toEqual([]);
  });

  it("preserves order, including flags that themselves take values", () => {
    expect(
      extractPassthroughArgs(["node", "cli.js", "create", "apps/web", "--", "--template", "react-ts", "--overwrite"]),
    ).toEqual(["--template", "react-ts", "--overwrite"]);
  });

  it("only splits on the first --, later ones stay in the passthrough segment", () => {
    expect(extractPassthroughArgs(["node", "cli.js", "create", "--", "--a", "--", "--b"])).toEqual([
      "--a",
      "--",
      "--b",
    ]);
  });
});
