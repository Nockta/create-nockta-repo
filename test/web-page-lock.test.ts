import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { renderCreateWebPage } from "../src/web/page.js";
import { buildWebProjectSchema } from "../src/web/project-schema.js";
import { emptyInjectSchema } from "../src/web/inject-schema.js";

/**
 * The create `--web` page's CLIENT JS, driven headlessly (vm harness — mirrors inject's
 * `test/web-page-client.test.ts` pattern): the inline script is extracted from
 * `renderCreateWebPage()`'s output and run in a `node:vm` context against a minimal DOM stub.
 *
 * Pins two behaviors:
 * 1. Owner-reported gap: after clicking "Create project" the form stayed fully interactable while
 *    the pipeline ran (tens of seconds). Now: the click locks EVERY control + mutes the form
 *    (`.busy`), a second click in flight produces NO second POST, and only a FAILED response
 *    unlocks (for a corrected resubmit) — success replaces the form with the done screen.
 * 2. Never-auto-submit: selecting a project type / toggling upstream options never POSTs /submit —
 *    only an explicit Create-project click does (pins the D36 false-alarm investigation).
 */

const TOKEN = "test-token";

// ---- minimal DOM stub (only what page.ts's script actually touches) ----

interface StubNode {
  tagName?: string;
  nodeType?: number;
  className: string;
  id?: string;
  children: StubNode[];
  attributes: Record<string, string>;
  listeners: Record<string, Array<() => void>>;
  textContent: string;
  style: Record<string, string>;
  type?: string;
  checked?: boolean;
  disabled?: boolean;
  value: string;
  placeholder?: string;
  parentNode?: StubNode | null;
  appendChild(child: StubNode): StubNode;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  addEventListener(event: string, fn: () => void): void;
  querySelector(selector: string): StubNode | null;
  querySelectorAll(selector: string): StubNode[];
  innerHTML: string;
  dispatch(event: string): void;
}

function makeNode(tagName?: string): StubNode {
  const node: StubNode = {
    tagName,
    className: "",
    children: [],
    attributes: {},
    listeners: {},
    textContent: "",
    style: {},
    checked: false,
    disabled: false,
    value: "",
    parentNode: null,
    appendChild(child) {
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    setAttribute(name, value) {
      node.attributes[name] = String(value);
    },
    getAttribute(name) {
      return name in node.attributes ? node.attributes[name]! : null;
    },
    removeAttribute(name) {
      delete node.attributes[name];
    },
    addEventListener(event, fn) {
      (node.listeners[event] ??= []).push(fn);
    },
    querySelector(selector) {
      return queryAll(node, selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      return queryAll(node, selector);
    },
    get innerHTML() {
      return "";
    },
    set innerHTML(v: string) {
      if (v === "") node.children = [];
    },
    dispatch(event) {
      for (const fn of node.listeners[event] ?? []) fn();
    },
  };
  return node;
}

function walk(root: StubNode, visit: (n: StubNode) => void): void {
  visit(root);
  for (const child of root.children) walk(child, visit);
}

/** One simple-selector match: `.cls`, `tag`, or `input[data-stepid="X"]`. */
function matches(n: StubNode, part: string): boolean {
  const attrMatch = /^input\[data-stepid="([^"]+)"\]$/.exec(part);
  if (attrMatch) return n.tagName === "input" && n.getAttribute("data-stepid") === attrMatch[1];
  if (part.startsWith(".")) {
    const classes = part.slice(1).split(".");
    const own = (n.className || "").split(/\s+/);
    return classes.every((c) => own.includes(c));
  }
  return n.tagName === part;
}

/** Selector shapes the script uses: simple parts, one-level descendant (".pill span"), comma lists ("input, button"). */
function queryAll(root: StubNode, selector: string): StubNode[] {
  if (selector.includes(",")) {
    return selector.split(",").flatMap((s) => queryAll(root, s.trim()));
  }
  const parts = selector.trim().split(/\s+/);
  let current: StubNode[] = [root];
  for (const part of parts) {
    const next: StubNode[] = [];
    for (const scope of current) {
      // descendants only, never the scope node itself
      for (const child of scope.children) {
        walk(child, (n) => {
          if (matches(n, part) && !next.includes(n)) next.push(n);
        });
      }
    }
    current = next;
  }
  return current;
}

interface FetchCall {
  url: string;
  options?: { method?: string; body?: string };
}

interface PageHarness {
  fetchCalls: FetchCall[];
  queueResponse(json: unknown): void;
  flushTimers(): void;
  input(stepId: string, value?: string): StubNode | undefined;
  clickConfirm(): void;
  confirmButton(): StubNode;
  err(): StubNode;
  masthead(): StubNode;
  app(): StubNode;
  allControls(): StubNode[];
}

function runPage(): PageHarness {
  const html = renderCreateWebPage(buildWebProjectSchema(), emptyInjectSchema(), TOKEN);
  const scriptMatch = /<script>([\s\S]*)<\/script>/.exec(html);
  expect(scriptMatch).toBeTruthy();

  const masthead = makeNode("div");
  masthead.className = "masthead";
  const app = makeNode("div");
  app.id = "app";
  app.className = "wrap";
  const body = makeNode("body");
  body.appendChild(masthead);
  body.appendChild(app);

  const documentStub = {
    createElement: (tag: string) => makeNode(tag),
    createTextNode: (text: string) => {
      const n = makeNode();
      n.nodeType = 3;
      n.textContent = text;
      return n;
    },
    getElementById: (id: string) => {
      let found: StubNode | null = null;
      walk(body, (n) => {
        if (!found && n.id === id) found = n;
      });
      return found;
    },
    querySelector: (selector: string) => queryAll(body, selector)[0] ?? null,
    querySelectorAll: (selector: string) => queryAll(body, selector),
    body,
  };

  const fetchCalls: FetchCall[] = [];
  const responses: unknown[] = [];
  const pendingTimers = new Map<number, () => void>();
  let nextTimerId = 1;

  const context = createContext({
    document: documentStub,
    fetch: (url: string, options?: { method?: string; body?: string }) => {
      fetchCalls.push({ url, options });
      const json = responses.shift();
      return Promise.resolve({ json: () => Promise.resolve(json) });
    },
    setTimeout: (fn: () => void) => {
      const id = nextTimerId++;
      pendingTimers.set(id, fn);
      return id;
    },
    clearTimeout: (handle: number) => {
      pendingTimers.delete(handle);
    },
  });
  runInContext(scriptMatch![1]!, context);

  return {
    fetchCalls,
    queueResponse: (json) => responses.push(json),
    flushTimers: () => {
      while (pendingTimers.size > 0) {
        const [id, fn] = pendingTimers.entries().next().value as [number, () => void];
        pendingTimers.delete(id);
        fn();
      }
    },
    input: (stepId, value) =>
      queryAll(body, `input[data-stepid="${stepId}"]`).find(
        (n) => value === undefined || n.getAttribute("data-value") === value,
      ),
    clickConfirm: () => {
      const btn = queryAll(body, ".confirm")[0];
      expect(btn).toBeDefined();
      btn!.dispatch("click");
    },
    confirmButton: () => queryAll(body, ".confirm")[0]!,
    err: () => queryAll(body, ".err")[0]!,
    masthead: () => masthead,
    app: () => app,
    allControls: () => queryAll(body, "input, button"),
  };
}

const tick = () => new Promise((r) => setImmediate(r));

/** Fill the two readiness requirements: a project name and a checked primary type. */
function makeReady(page: PageHarness): void {
  page.input("project-path")!.value = "lock-app";
  page.input("repo-type", "next")!.checked = true;
}

describe("create web page client JS — in-flight form lock (owner-reported gap)", () => {
  it("clicking Create locks EVERY control + mutes the form; a FAILED response unlocks for resubmit; pre-disabled controls stay disabled", async () => {
    const page = runPage();
    makeReady(page);
    // Simulate a control that was ALREADY disabled before submit (e.g. a locked row / the
    // primary's also-toggle): the lock must never take ownership of it.
    const preDisabled = page.input("also-types", "expo")!;
    preDisabled.disabled = true;

    page.queueResponse({ ok: false, error: "boom" });
    page.clickConfirm();

    // Synchronously after the click: everything locked, form muted, busy message up.
    expect(page.app().className).toBe("wrap busy");
    expect(page.confirmButton().disabled).toBe(true);
    expect(page.err().textContent).toMatch(/Working…/);
    const enabledDuringFlight = page.allControls().filter((c) => !c.disabled);
    expect(enabledDuringFlight).toHaveLength(0);
    expect(preDisabled.getAttribute("data-submit-locked")).toBeNull(); // never marked

    // Failure response: unlock so the user can correct + resubmit (server-side one-shot allows retry pre-run).
    await tick();
    await tick();
    expect(page.app().className).toBe("wrap");
    expect(page.confirmButton().disabled).toBe(false);
    expect(page.input("project-path")!.disabled).toBe(false);
    expect(preDisabled.disabled).toBe(true); // untouched by the unlock
    expect(page.err().textContent).toMatch(/Submit failed: boom/);
  });

  it("a second Create click while a submit is in flight produces NO second POST; success reaches the done screen still-locked", async () => {
    const page = runPage();
    makeReady(page);

    page.queueResponse({ ok: true, result: { ok: true, exitCode: 0, projectPath: "lock-app" } });
    page.clickConfirm();
    page.clickConfirm(); // in-flight double click (stub dispatches regardless of disabled — pins the submitting guard too)
    await tick();
    await tick();

    const submits = page.fetchCalls.filter((c) => c.url.includes("/submit"));
    expect(submits).toHaveLength(1);
    expect(page.masthead().style["display"]).toBe("none"); // done screen replaced the form — no unlock on success
  });

  it("a requiresTerminal result renders the terminal-handoff screen (no unlock churn, no error state)", async () => {
    const page = runPage();
    makeReady(page);

    page.queueResponse({
      ok: false,
      result: {
        ok: false,
        exitCode: 0,
        projectPath: "lock-app",
        requiresTerminal: { reason: "needs a Partner login", command: "npm create nockta-repo@latest -- lock-app --type shopify-app --cli" },
      },
    });
    page.clickConfirm();
    await tick();
    await tick();

    expect(page.masthead().style["display"]).toBe("none"); // handoff screen replaced the form
  });
});

describe("create web page client JS — never-auto-submit (D36 false-alarm pin)", () => {
  it("typing a name, selecting a type, and toggling upstream options never POSTs /submit", async () => {
    const page = runPage();

    // Type a project name.
    const path = page.input("project-path")!;
    path.value = "eyeball-app";
    path.dispatch("input");

    // Select the primary type (fires the full reactive chain: arch rebuild, upstream-options
    // rebuild, also-disabling, confirm gate, debounced skills refetch).
    const next = page.input("repo-type", "next")!;
    next.checked = true;
    page.queueResponse({ steps: [] }); // the /inject-schema refetch's response
    next.dispatch("change");
    page.flushTimers();
    await tick();

    // The upstream-options card exists now — toggle a boolean option too.
    const srcDir = page.input("uopt:srcDir");
    expect(srcDir).toBeDefined();
    srcDir!.checked = true;
    srcDir!.dispatch("change");
    page.flushTimers();
    await tick();

    // The reactive schema fetch may fire; /submit must NEVER have.
    const submits = page.fetchCalls.filter((c) => c.url.includes("/submit"));
    expect(submits).toHaveLength(0);
    expect(page.masthead().style["display"]).not.toBe("none");

    // And an explicit click is still the one and only way to submit.
    page.queueResponse({ ok: true, result: { ok: true, exitCode: 0, projectPath: "eyeball-app" } });
    page.clickConfirm();
    await tick();
    await tick();
    expect(page.fetchCalls.filter((c) => c.url.includes("/submit"))).toHaveLength(1);
  });
});
