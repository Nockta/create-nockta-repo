import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { buildWebProjectSchema } from "../src/web/project-schema.js";
import { fetchInjectSchema } from "../src/web/inject-schema.js";
import { renderCreateWebPage } from "../src/web/page.js";

/**
 * Regenerates the static preview of create's two-section `--web` page (decisions.md D30 proof).
 * Renders with a REAL `next` inject schema (fetched via emit-schema, using the local inject build
 * through CREATE_NOCKTA_REPO_TEST_INJECT_BIN) so the Skills section shows populated. Standalone HTML.
 */
async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("usage: gen-web-preview <output.html>");
  const project = buildWebProjectSchema({ presetType: "next" });
  const skills = await fetchInjectSchema({ types: "next", adapters: "claude" });
  const html = renderCreateWebPage(project, skills, "preview-token-not-a-real-server");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, html, "utf8");
  process.stderr.write(`wrote ${out} (${Buffer.byteLength(html)} bytes)\n`);
}
main().catch((e) => { process.stderr.write(String(e) + "\n"); process.exit(1); });
