import type { WebProjectSchema } from "./project-schema.js";
import type { InjectWizardSchema } from "./inject-schema.js";

/**
 * create's self-contained `--web` page (decisions.md D30) — one HTML string, inline CSS + JS, NO
 * external CDN/font/network reference (D30 security + offline requirement). TWO stacked sections,
 * the owner's RESOLVED layout: "Project" first, then "Skills" (two visual sections, Project on top,
 * Skills below — NOT one undifferentiated scroll, NOT tabs).
 *
 *   - Section "Project": create's OWN genesis Model (`WebProjectSchema`) — project name/path,
 *     repo-type (single), also-types (multi), package-manager, architecture, skills-version.
 *   - Section "Skills": inject's emitted schema (`InjectWizardSchema`, fetched via the emit-schema
 *     CLI contract) — adapters (multi), skills as PER-DOMAIN cards (Common, Next.js, …), and razor
 *     as its own card with DIVIDER rows between categories. This card-per-domain + category-divider
 *     structure is REUSED verbatim from inject's own `src/web/page.ts` (owner made it the standard
 *     for both web pages).
 *
 * VISUAL LANGUAGE: the curation-board token system + card/pill/razor-accent styling, copied from
 * inject's page so the two surfaces read identically.
 *
 * REACTIVITY: changing repo-type/also-types (or adapters) re-fetches `GET /inject-schema?...` and
 * re-renders ONLY the Skills section (debounced, stale-guarded via a seq counter, like inject). The
 * Project inputs stay intact. Empty state: with no primary type chosen, the Skills section shows a
 * "pick a project type to see skills" placeholder and no fetch fires.
 */

/** JSON for a `<script>` context — escapes the only sequences that can break out of it. */
function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/[\u2028\u2029]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16));
}

export function renderCreateWebPage(project: WebProjectSchema, skills: InjectWizardSchema, token: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>create-nockta-repo — New project</title>
<style>
  :root {
    --bg: #eef1f5; --bg-raised: #f7f9fb; --surface: #ffffff; --surface-2: #f3f6f9;
    --ink: #1a2029; --ink-soft: #3a4250; --muted: #5c6675; --faint: #8993a3;
    --border: #dde3ea; --border-strong: #c7d0da;
    --accent: #2f6690; --accent-ink: #1f4a6b; --accent-tint: #e4edf4; --accent-ring: rgba(47,102,144,0.35);
    --on: #2f7a56; --on-tint: #e3f2ea;
    --lock: #46505f; --lock-tint: #e7eaee;
    --razor: #7d4f9e; --razor-ink: #5e3a79; --razor-tint: #f1e8f7;
    --clash: #b0446a; --clash-ink: #8f2f52; --clash-tint: #f9e6ec;
    --shadow-card: 0 1px 2px rgba(20,28,38,0.06), 0 8px 20px -12px rgba(20,28,38,0.18);
    --radius: 10px; --radius-sm: 6px;
    --font-body: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --font-mono: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, "Liberation Mono", monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #12161c; --bg-raised: #171c23; --surface: #1a2029; --surface-2: #212832;
      --ink: #e9edf2; --ink-soft: #c4ccd6; --muted: #96a1af; --faint: #6d7885;
      --border: #2a323d; --border-strong: #384252;
      --accent: #6fa8d4; --accent-ink: #bcdcf5; --accent-tint: #1c2c38; --accent-ring: rgba(111,168,212,0.4);
      --on: #6fc79b; --on-tint: #17301f;
      --lock: #b9c2cf; --lock-tint: #262d37;
      --razor: #b98fda; --razor-ink: #d9bdf0; --razor-tint: #2a2036;
      --clash: #e08aa8; --clash-ink: #f0c2d2; --clash-tint: #35202a;
      --shadow-card: 0 1px 2px rgba(0,0,0,0.3), 0 12px 26px -14px rgba(0,0,0,0.55);
    }
  }
  * { box-sizing: border-box; }
  html { color-scheme: light dark; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--font-body); font-size: 15px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
  ::selection { background: var(--accent-ring); }
  .mono { font-family: var(--font-mono); }

  .masthead { max-width: 900px; margin: 0 auto; padding: 34px 22px 8px; }
  .eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--faint); }
  .masthead h1 { font-size: 25px; letter-spacing: -0.01em; margin: 6px 0 0; font-weight: 700; text-wrap: balance; }
  .masthead p { margin: 6px 0 0; color: var(--muted); max-width: 62ch; font-size: 14px; }

  .wrap { max-width: 900px; margin: 0 auto; padding: 10px 22px 130px; }

  /* The two big section bands ("Project" / "Skills") — the resolved D30 layout marker. */
  .section-band { display: flex; align-items: baseline; gap: 12px; margin: 30px 0 2px; padding-bottom: 8px; border-bottom: 2px solid var(--border-strong); }
  .section-band:first-child { margin-top: 14px; }
  .section-band .num { font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: #fff; background: var(--accent); border-radius: 999px; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; flex: none; }
  .section-band h2 { font-size: 19px; font-weight: 700; margin: 0; }
  .section-band .sub { color: var(--muted); font-size: 13px; }

  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-card); overflow: hidden; margin-top: 16px; }
  .card > .card-head { padding: 15px 20px; background: var(--surface-2); border-bottom: 1px solid var(--border); display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .card > .card-head h3 { font-size: 16px; font-weight: 700; margin: 0; }
  .card > .card-head .card-hint { color: var(--muted); font-size: 12.5px; }
  .card.razor { border-color: var(--razor); border-left-width: 3px; }
  .card.razor > .card-head { background: var(--razor-tint); }
  .card.razor > .card-head h3 { color: var(--razor-ink); }
  .razor-badge { font-size: 10.5px; font-weight: 700; letter-spacing: 0.03em; color: var(--razor-ink); background: var(--razor-tint); border: 1px solid var(--razor); padding: 2px 9px; border-radius: 999px; }
  .card-body { padding: 6px 20px 14px; }

  .section-h { margin: 16px 0 4px; font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--faint); font-weight: 700; }
  .card.razor .section-h { color: var(--razor-ink); }
  .section-h:first-child { margin-top: 4px; }

  .group-divider { height: 1px; margin: 14px 0 2px; background: var(--border); border: none; }
  .card.razor .group-divider { background: var(--razor); opacity: 0.3; }

  .field { padding: 12px 6px; }
  .field label.flabel { display: block; font-family: var(--font-mono); font-weight: 700; font-size: 13.5px; color: var(--ink); margin-bottom: 6px; }
  .field input[type=text] { width: 100%; max-width: 480px; padding: 9px 12px; font-size: 14px; font-family: var(--font-mono); color: var(--ink); background: var(--bg-raised); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }
  .field input[type=text]:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .field .fhint { font-size: 12px; color: var(--muted); margin-top: 5px; }

  .choice { display: flex; gap: 14px; padding: 12px 6px; border-bottom: 1px solid var(--border); align-items: flex-start; }
  .choice:last-child { border-bottom: none; }
  .choice .cbody { min-width: 0; flex: 1; }
  .choice .cname { font-family: var(--font-mono); font-weight: 700; font-size: 13.5px; color: var(--ink); }
  .choice .cname .enum { color: var(--faint); font-weight: 400; font-size: 11.5px; margin-left: 7px; }
  .choice .cdesc { font-size: 12.5px; color: var(--ink-soft); margin-top: 3px; line-height: 1.45; max-width: 60ch; }
  .choice .clocknote { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--lock); margin-top: 6px; }
  .clash-note { font-size: 11.5px; color: var(--clash-ink); background: var(--clash-tint); border: 1px solid var(--clash); border-radius: var(--radius-sm); padding: 5px 9px; margin-top: 7px; line-height: 1.45; max-width: 60ch; }
  .clash-note b { font-weight: 700; }
  .clash-note .clash-names { font-family: var(--font-mono); }

  .toggle { position: relative; flex: none; }
  .toggle input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
  .toggle .pill { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-width: 90px; padding: 7px 14px; border-radius: 999px; border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--muted); font-size: 12px; font-weight: 600; cursor: pointer; user-select: none; transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease; }
  .toggle .pill::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--faint); flex: none; }
  .toggle input:checked + .pill { background: var(--on); border-color: var(--on); color: #fff; }
  .toggle input:checked + .pill::before { background: #fff; }
  .toggle.single input:checked + .pill { background: var(--accent); border-color: var(--accent); }
  .toggle input:focus-visible + .pill { outline: 2px solid var(--accent); outline-offset: 2px; }

  .lock-pill { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 90px; padding: 7px 12px; border-radius: 999px; background: var(--lock-tint); color: var(--lock); font-size: 11.5px; font-weight: 700; border: 1px solid var(--border-strong); cursor: default; }

  .placeholder { text-align: center; padding: 34px 20px; color: var(--muted); font-size: 13.5px; }
  .placeholder .big { font-size: 15px; color: var(--ink-soft); font-weight: 600; margin-bottom: 4px; }

  .bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 40; background: color-mix(in srgb, var(--bg-raised) 92%, transparent); backdrop-filter: blur(10px) saturate(1.1); -webkit-backdrop-filter: blur(10px) saturate(1.1); border-top: 1px solid var(--border); }
  .bar .inner { max-width: 900px; margin: 0 auto; padding: 13px 22px; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  .bar .hint { color: var(--faint); font-size: 12.5px; }
  .bar .err { color: var(--clash-ink); font-size: 12.5px; }
  button.confirm { appearance: none; background: var(--accent); color: #fff; border: 1px solid var(--accent); border-radius: 999px; padding: 10px 22px; font-size: 14px; font-weight: 700; cursor: pointer; white-space: nowrap; transition: background 0.12s ease, transform 0.05s ease; }
  button.confirm:hover { background: var(--accent-ink); border-color: var(--accent-ink); }
  button.confirm:active { transform: translateY(1px); }
  button.confirm:disabled { opacity: 0.5; cursor: default; }

  .done { text-align: center; padding: 120px 24px; }
  .done .check { width: 68px; height: 68px; margin: 0 auto; border-radius: 50%; background: var(--on-tint); color: var(--on); display: flex; align-items: center; justify-content: center; font-size: 34px; border: 1px solid var(--on); }
  .done.fail .check { background: var(--clash-tint); color: var(--clash-ink); border-color: var(--clash); }
  .done h2 { font-size: 22px; margin: 18px 0 6px; font-weight: 700; }
  .done p { color: var(--muted); }
  .done.handoff .check { background: var(--lock-tint); color: var(--lock); border-color: var(--border-strong); }
  .cmdbox { margin: 18px auto 0; max-width: 560px; text-align: left; padding: 12px 14px; background: var(--surface-2); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); font-size: 13px; color: var(--ink); overflow-x: auto; white-space: pre; }

  /* D36 upstream-scaffolder options + requiresTerminal warning */
  .warn-note { font-size: 12.5px; color: var(--lock); background: var(--lock-tint); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 10px 12px; line-height: 1.5; max-width: 62ch; }
  .warn-note b { font-weight: 700; }
</style>
</head>
<body>
<div class="masthead">
  <div class="eyebrow">create-nockta-repo</div>
  <h1>Create a new project</h1>
  <p>Set up the project, then choose agent tools and skills. Nothing is scaffolded until you confirm.</p>
</div>
<div id="app" class="wrap"></div>
<script>
(function () {
  "use strict";
  var PROJECT = ${embedJson(project)};
  var SKILLS = ${embedJson(skills)};
  var TOKEN = ${embedJson(token)};

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function displayName(c) { return c.title != null ? c.title : (c.label != null ? c.label : c.value); }
  function groupKey(x) { return x.section != null ? x.section : (x.key != null ? x.key : x.pack); }

  // Friendly pack titles for the Skills section's per-domain card headers — read from the PROJECT
  // repo-type step's choices (same REPO_TYPE_TITLES inject uses), so "next" -> "Next.js" etc.
  var packTitles = (function () {
    var map = {};
    (PROJECT.steps || []).forEach(function (s) {
      if (s.id === "repo-type" && s.choices) s.choices.forEach(function (c) { if (c.title) map[c.value] = c.title; });
    });
    return map;
  })();
  function packCardTitle(section) { return packTitles[section.pack] || section.label; }

  function tagInput(input, stepId, choice) {
    input.setAttribute("data-stepid", stepId);
    input.setAttribute("data-value", choice.value);
    if (choice.tier != null) input.setAttribute("data-tier", choice.tier);
  }

  // ---- shared choice row (pill toggle, or locked pill). single=radio semantics. ----
  function renderChoice(stepId, choice, opts) {
    opts = opts || {};
    var row = el("div", "choice");
    if (choice.disabled) {
      var lock = el("span", "lock-pill");
      lock.appendChild(document.createTextNode("\\uD83D\\uDD12 Locked"));
      row.appendChild(lock);
      var hidden = el("input"); hidden.type = "checkbox"; hidden.checked = !!choice.checked; hidden.disabled = true; hidden.style.display = "none";
      tagInput(hidden, stepId, choice);
      row.appendChild(hidden);
    } else {
      var t = el("label", "toggle" + (opts.single ? " single" : ""));
      var box = el("input"); box.type = "checkbox"; box.checked = !!choice.checked;
      tagInput(box, stepId, choice);
      var pill = el("span", "pill");
      var pillText = el("span", null, pillLabel(box.checked, opts.single));
      pill.appendChild(pillText);
      box.addEventListener("change", function () {
        if (opts.single) enforceRadio(stepId, box);
        pillText.textContent = pillLabel(box.checked, opts.single);
        syncPillLabels(stepId, opts.single);
        if (opts.onChange) opts.onChange();
      });
      t.appendChild(box); t.appendChild(pill);
      row.appendChild(t);
    }
    var body = el("div", "cbody");
    var name = el("div", "cname");
    name.appendChild(document.createTextNode(displayName(choice)));
    if (choice.title != null && choice.value !== choice.title) name.appendChild(el("span", "enum", choice.value));
    body.appendChild(name);
    if (choice.description) body.appendChild(el("div", "cdesc", choice.description));
    if (choice.disabled && choice.disabledReason) body.appendChild(el("div", "clocknote", choice.disabledReason));
    if (choice.clashesWith && choice.clashesWith.length) {
      var clash = el("div", "clash-note");
      clash.appendChild(el("b", null, "\\u26A0 Overlaps with "));
      clash.appendChild(el("span", "clash-names", choice.clashesWith.join(", ")));
      clash.appendChild(document.createTextNode(" — enable at your discretion."));
      body.appendChild(clash);
    }
    row.appendChild(body);
    return row;
  }
  function pillLabel(checked, single) { return single ? (checked ? "Selected" : "Select") : (checked ? "On" : "Off"); }
  function inputsFor(stepId) { return document.querySelectorAll('input[data-stepid="' + stepId + '"]'); }
  function enforceRadio(stepId, justChanged) {
    if (justChanged.checked) {
      inputsFor(stepId).forEach(function (inp) { if (inp !== justChanged) inp.checked = false; });
    } else {
      // radio can't go empty once chosen: re-check the one the user tried to clear
      justChanged.checked = true;
    }
  }
  function syncPillLabels(stepId, single) {
    inputsFor(stepId).forEach(function (inp) {
      var span = inp.parentNode && inp.parentNode.querySelector(".pill span");
      if (span) span.textContent = pillLabel(inp.checked, single);
    });
  }
  function checkedValues(stepId) {
    var out = []; inputsFor(stepId).forEach(function (inp) { if (inp.checked) out.push(inp.getAttribute("data-value")); }); return out;
  }
  function firstChecked(stepId) { var v = checkedValues(stepId); return v.length ? v[0] : null; }
  function deltasFor(stepId) {
    var excluded = [], included = [];
    inputsFor(stepId).forEach(function (inp) {
      var tier = inp.getAttribute("data-tier"); var v = inp.getAttribute("data-value");
      if (tier === "default" && !inp.checked) excluded.push(v);
      if (tier === "optional" && inp.checked) included.push(v);
    });
    return { excluded: excluded, included: included };
  }

  // ================= PROJECT SECTION =================
  function renderProjectStep(step) {
    if (step.id === "project-path") return renderTextField(step, "project-path", "e.g. my-app  or  apps/web", "Name a new folder, or a nested path inside a monorepo.");
    if (step.id === "skills-version") return renderSkillsVersion(step);
    // repo-type / package-manager / architecture -> single select card; also-types -> multi.
    var single = step.single === true;
    var card = el("div", "card");
    var head = el("div", "card-head"); head.appendChild(el("h3", null, step.title)); card.appendChild(head);
    var body = el("div", "card-body");
    var onChange = null;
    if (step.id === "repo-type") onChange = function () { onPrimaryTypeChange(); };
    if (step.id === "also-types") onChange = function () { scheduleRederive(); };
    (step.choices || []).forEach(function (c) { body.appendChild(renderChoice(step.id, c, { single: single, onChange: onChange })); });
    card.appendChild(body);
    return card;
  }

  function renderTextField(step, stepId, placeholder, hint) {
    var card = el("div", "card");
    var head = el("div", "card-head"); head.appendChild(el("h3", null, step.title)); card.appendChild(head);
    var body = el("div", "card-body");
    var f = el("div", "field");
    var input = el("input"); input.type = "text"; input.setAttribute("data-stepid", stepId); input.placeholder = placeholder;
    input.addEventListener("input", updateConfirmEnabled);
    f.appendChild(input);
    if (hint) f.appendChild(el("div", "fhint", hint));
    body.appendChild(f); card.appendChild(body);
    return card;
  }

  function renderSkillsVersion(step) {
    var card = el("div", "card");
    var head = el("div", "card-head"); head.appendChild(el("h3", null, step.title)); card.appendChild(head);
    var body = el("div", "card-body");
    (step.choices || []).forEach(function (c) {
      body.appendChild(renderChoice("skills-version", c, { single: true, onChange: function () { toggleCustomVersion(); } }));
    });
    var f = el("div", "field"); f.id = "sv-custom-wrap"; f.style.display = "none";
    var input = el("input"); input.type = "text"; input.setAttribute("data-stepid", "skills-version-custom"); input.placeholder = "e.g. 2.4.1  or  next";
    f.appendChild(input);
    f.appendChild(el("div", "fhint", "A version or dist-tag; leave blank for latest."));
    body.appendChild(f); card.appendChild(body);
    return card;
  }
  function toggleCustomVersion() {
    var wrap = document.getElementById("sv-custom-wrap"); if (!wrap) return;
    var custom = firstChecked("skills-version");
    wrap.style.display = custom === "__custom__" ? "" : "none";
  }

  // Architecture presets depend on the chosen primary type — rebuild the arch card's choices
  // client-side (no server round-trip) from PROJECT.archPresetsByType when the primary changes.
  function onPrimaryTypeChange() {
    rebuildArchitecture();
    rebuildUpstreamOptions();
    updateAlsoDisabling();
    updateConfirmEnabled();
    scheduleRederive();
  }
  function rebuildArchitecture() {
    var primary = firstChecked("repo-type");
    var card = document.getElementById("arch-body"); if (!card) return;
    var presets = (primary && PROJECT.archPresetsByType[primary]) || [];
    var current = firstChecked("architecture");
    card.innerHTML = "";
    var def = presets.indexOf("standard") !== -1 ? "standard" : (presets[0] || PROJECT.noArchitectureValue);
    var choices = presets.map(function (p) { return { value: p, label: p, checked: false, disabled: false }; });
    choices.push({ value: PROJECT.noArchitectureValue, label: "none — skip the architecture overlay entirely", checked: false, disabled: false });
    var keep = current && choices.some(function (c) { return c.value === current; }) ? current : def;
    choices.forEach(function (c) { c.checked = c.value === keep; card.appendChild(renderChoice("architecture", c, { single: true })); });
  }
  function updateAlsoDisabling() {
    var primary = firstChecked("repo-type");
    inputsFor("also-types").forEach(function (inp) {
      var isPrimary = inp.getAttribute("data-value") === primary;
      if (isPrimary) { inp.checked = false; }
      inp.disabled = isPrimary;
      var pill = inp.parentNode && inp.parentNode.querySelector(".pill");
      if (pill) pill.style.opacity = isPrimary ? "0.4" : "";
    });
    syncPillLabels("also-types", false);
  }

  // ---- D36: upstream-scaffolder options (per selected primary type) ----
  // Rebuilt client-side on a type change (like the architecture card) from the
  // maps embedded in PROJECT — no server round-trip. Types that pin every
  // choice render nothing; a requiresTerminal type renders an up-front warning.
  function rebuildUpstreamOptions() {
    var host = document.getElementById("upstream-options"); if (!host) return;
    host.innerHTML = "";
    var primary = firstChecked("repo-type");
    if (!primary) return;
    var reason = PROJECT.requiresTerminalByType && PROJECT.requiresTerminalByType[primary];
    if (reason) { host.appendChild(renderRequiresTerminalCard(reason)); return; }
    var opts = (PROJECT.upstreamOptionsByType && PROJECT.upstreamOptionsByType[primary]) || [];
    if (opts.length === 0) return;
    host.appendChild(renderUpstreamOptionsCard(opts));
  }
  function renderRequiresTerminalCard(reason) {
    var card = el("div", "card");
    var head = el("div", "card-head"); head.appendChild(el("h3", null, "Finish in your terminal")); card.appendChild(head);
    var body = el("div", "card-body");
    var w = el("div", "warn-note");
    w.appendChild(el("b", null, "\\u26A0 This project type can't be created from the browser. "));
    w.appendChild(document.createTextNode(reason));
    body.appendChild(w);
    card.appendChild(body); return card;
  }
  function renderUpstreamOptionsCard(opts) {
    var card = el("div", "card");
    var head = el("div", "card-head");
    head.appendChild(el("h3", null, "Upstream scaffolder options"));
    head.appendChild(el("span", "card-hint", "Passed to the official scaffolder"));
    card.appendChild(head);
    var body = el("div", "card-body");
    opts.forEach(function (o) { body.appendChild(renderUpstreamOption(o)); });
    card.appendChild(body); return card;
  }
  function renderUpstreamOption(o) {
    var stepId = "uopt:" + o.key;
    if (o.kind === "boolean") {
      return renderChoice(stepId, { value: "true", label: o.label, description: o.description, checked: o["default"] === true }, {});
    }
    if (o.kind === "choice") {
      var wrap = el("div");
      wrap.appendChild(el("div", "section-h", o.label));
      (o.choices || []).forEach(function (c) {
        wrap.appendChild(renderChoice(stepId, { value: c.value, label: c.label, checked: c.value === o["default"] }, { single: true }));
      });
      if (o.description) wrap.appendChild(el("div", "fhint", o.description));
      return wrap;
    }
    // text
    var f = el("div", "field");
    f.appendChild(el("label", "flabel", o.label));
    var input = el("input"); input.type = "text"; input.setAttribute("data-stepid", stepId);
    input.value = o["default"] != null ? o["default"] : "";
    f.appendChild(input);
    if (o.description) f.appendChild(el("div", "fhint", o.description));
    return f;
  }
  function collectUpstreamOptions() {
    var primary = firstChecked("repo-type");
    var opts = (primary && PROJECT.upstreamOptionsByType && PROJECT.upstreamOptionsByType[primary]) || [];
    var out = {};
    opts.forEach(function (o) {
      var stepId = "uopt:" + o.key;
      if (o.kind === "boolean") out[o.key] = checkedValues(stepId).length > 0;
      else if (o.kind === "choice") { var v = firstChecked(stepId); out[o.key] = v != null ? v : o["default"]; }
      else { var inp = document.querySelector('input[data-stepid="' + stepId + '"]'); out[o.key] = inp ? inp.value.trim() : o["default"]; }
    });
    return out;
  }

  // ================= SKILLS SECTION (inject's schema) =================
  function sectionRuns(step) {
    var choices = step.choices || []; var sections = step.sections || [];
    var runs = sections.map(function (sec) {
      var key = groupKey(sec);
      return { section: sec, choices: choices.filter(function (c) { return groupKey(c) === key; }) };
    }).filter(function (r) { return r.choices.length > 0; });
    var leftover = choices.filter(function (c) { return !sections.some(function (s) { return groupKey(s) === groupKey(c); }); });
    if (leftover.length > 0) runs.push({ section: null, choices: leftover });
    return runs;
  }
  function renderAdaptersCard(step) {
    var card = el("div", "card");
    var head = el("div", "card-head"); head.appendChild(el("h3", null, step.title)); card.appendChild(head);
    var body = el("div", "card-body");
    (step.choices || []).forEach(function (c) { body.appendChild(renderChoice("adapters", c, { onChange: function () { scheduleRederive(); } })); });
    card.appendChild(body);
    return [card];
  }
  function renderSkillCards(step) {
    var runs = sectionRuns(step);
    if (runs.length === 0) return [];
    return runs.map(function (run) {
      var card = el("div", "card");
      var head = el("div", "card-head");
      head.appendChild(el("h3", null, run.section ? packCardTitle(run.section) : step.title));
      card.appendChild(head);
      var body = el("div", "card-body");
      run.choices.forEach(function (c) { body.appendChild(renderChoice("skills", c, {})); });
      card.appendChild(body);
      return card;
    });
  }
  function renderRazorCard(step) {
    var runs = sectionRuns(step);
    var card = el("div", "card razor");
    var head = el("div", "card-head");
    head.appendChild(el("h3", null, step.title));
    head.appendChild(el("span", "razor-badge", "Razor \\u00B7 engineering doctrine"));
    card.appendChild(head);
    var body = el("div", "card-body");
    runs.forEach(function (run, i) {
      if (i > 0) body.appendChild(el("hr", "group-divider"));
      if (run.section) body.appendChild(el("div", "section-h", run.section.label));
      run.choices.forEach(function (c) { body.appendChild(renderChoice("razor", c, {})); });
    });
    card.appendChild(body);
    return [card];
  }

  var skillsEl = null;
  function renderSkillsSection() {
    if (!skillsEl) return;
    skillsEl.innerHTML = "";
    var steps = SKILLS.steps || [];
    var hasSkills = steps.some(function (s) { return s.id === "skills" || s.id === "adapters"; });
    if (!hasSkills) {
      var ph = el("div", "card");
      var b = el("div", "placeholder");
      b.appendChild(el("div", "big", "No project type chosen yet"));
      b.appendChild(el("div", null, "Pick a project type in the Project section above to see the agent tools and skills available for it."));
      ph.appendChild(b); skillsEl.appendChild(ph); return;
    }
    steps.forEach(function (step) {
      if (step.id === "adapters") renderAdaptersCard(step).forEach(function (c) { skillsEl.appendChild(c); });
      else if (step.id === "skills") renderSkillCards(step).forEach(function (c) { skillsEl.appendChild(c); });
      else if (step.id === "razor") renderRazorCard(step).forEach(function (c) { skillsEl.appendChild(c); });
      // inject's own repo-type/confirm/targets steps are intentionally NOT rendered here (repo-type
      // lives in the Project section; confirm is create's bottom button).
    });
  }

  // ---- reactive re-derivation (debounced, stale-safe, selection-preserving) ----
  var deriveSeq = 0, deriveTimer = null;
  function currentTypesCsv() {
    var primary = firstChecked("repo-type");
    if (!primary) return "";
    var also = checkedValues("also-types").filter(function (t) { return t !== primary; });
    return [primary].concat(also).join(",");
  }
  function currentAdaptersCsv() { return checkedValues("adapters").join(","); }

  function captureSelections() {
    // For each Skills-section step, remember which values existed and which were checked, so a
    // re-fetch never silently wipes the user's adapter/skill/razor choices (uniform across all three).
    var snap = {};
    ["adapters", "skills", "razor"].forEach(function (id) {
      var seen = {}, checked = {};
      inputsFor(id).forEach(function (inp) { var v = inp.getAttribute("data-value"); seen[v] = true; if (inp.checked) checked[v] = true; });
      snap[id] = { seen: seen, checked: checked };
    });
    return snap;
  }
  function applySelections(snap) {
    if (!snap) return;
    ["adapters", "skills", "razor"].forEach(function (id) {
      var s = snap[id]; if (!s) return;
      inputsFor(id).forEach(function (inp) {
        var v = inp.getAttribute("data-value");
        if (s.seen[v] && !inp.disabled) {
          inp.checked = !!s.checked[v];
          var span = inp.parentNode && inp.parentNode.querySelector(".pill span");
          if (span) span.textContent = pillLabel(inp.checked, false);
        }
      });
    });
  }

  function scheduleRederive() { if (deriveTimer) clearTimeout(deriveTimer); deriveTimer = setTimeout(rederive, 150); }
  function rederive() {
    var types = currentTypesCsv();
    if (!types) { SKILLS = { steps: [] }; renderSkillsSection(); return; }
    var snap = captureSelections();
    var seq = ++deriveSeq;
    var url = "/inject-schema?t=" + encodeURIComponent(TOKEN) + "&types=" + encodeURIComponent(types) + "&adapters=" + encodeURIComponent(currentAdaptersCsv());
    fetch(url).then(function (r) { return r.json(); }).then(function (newSchema) {
      if (seq !== deriveSeq) return; // a newer toggle already fired — ignore this stale response
      if (!newSchema || !newSchema.steps) return;
      SKILLS = newSchema;
      renderSkillsSection();
      applySelections(snap);
    }).catch(function () { /* transient — the next toggle retries */ });
  }

  // ---- collect + submit ----
  function collectAnswers() {
    var primary = firstChecked("repo-type");
    var also = checkedValues("also-types").filter(function (t) { return t !== primary; });
    var archVal = firstChecked("architecture");
    var architecture = archVal === PROJECT.noArchitectureValue ? false : archVal;
    var pathInput = document.querySelector('input[data-stepid="project-path"]');
    var svCustom = firstChecked("skills-version") === "__custom__";
    var svInput = document.querySelector('input[data-stepid="skills-version-custom"]');
    var skillsVersion = undefined;
    if (svCustom && svInput && svInput.value.trim().length > 0) skillsVersion = svInput.value.trim();
    var skillsDelta = SKILLS.steps && SKILLS.steps.some(function (s) { return s.id === "skills"; }) ? deltasFor("skills") : { excluded: [], included: [] };
    var razorDelta = SKILLS.steps && SKILLS.steps.some(function (s) { return s.id === "razor"; }) ? deltasFor("razor") : { excluded: [], included: [] };
    return {
      projectPath: pathInput ? pathInput.value.trim() : "",
      repoType: primary,
      alsoTypes: also,
      packageManager: firstChecked("package-manager"),
      architecture: architecture,
      skillsVersion: skillsVersion,
      adapters: checkedValues("adapters"),
      skills: skillsDelta,
      razor: razorDelta,
      upstreamOptions: collectUpstreamOptions(),
      confirmed: true
    };
  }
  function isReady() {
    var pathInput = document.querySelector('input[data-stepid="project-path"]');
    return !!(pathInput && pathInput.value.trim().length > 0) && !!firstChecked("repo-type");
  }
  function updateConfirmEnabled() {
    var btn = document.getElementById("confirm-btn"); if (!btn) return;
    btn.disabled = !isReady();
    var hint = document.getElementById("confirm-hint");
    if (hint) hint.textContent = isReady() ? "Nothing is scaffolded until you confirm." : "Enter a project name and pick a project type to continue.";
  }

  function showDone(ok, res) {
    document.querySelector(".masthead").style.display = "none";
    var bar = document.querySelector(".bar"); if (bar) bar.style.display = "none";
    var app = document.getElementById("app"); app.className = ""; app.innerHTML = "";
    // D36 / PART A: a terminal-handoff (requiresTerminal) — neither success nor
    // a crash; tell the user exactly what to run in their terminal.
    if (res && res.requiresTerminal) {
      var h = el("div", "done handoff");
      var hchk = el("div", "check"); hchk.textContent = "\\u2318"; h.appendChild(hchk);
      h.appendChild(el("h2", null, "Finish in your terminal"));
      h.appendChild(el("p", null, res.requiresTerminal.reason));
      var cmd = el("div", "cmdbox mono"); cmd.textContent = res.requiresTerminal.command; h.appendChild(cmd);
      app.appendChild(h); return;
    }
    var d = el("div", "done" + (ok ? "" : " fail"));
    var chk = el("div", "check"); chk.textContent = ok ? "\\u2713" : "\\u2717"; d.appendChild(chk);
    d.appendChild(el("h2", null, ok ? "Project created — you can close this tab" : "Something went wrong"));
    d.appendChild(el("p", null, ok
      ? "create-nockta-repo scaffolded your project, applied the overlay, and installed your skills. Return to the terminal for the full summary."
      : "The run did not finish cleanly (exit " + ((res && res.exitCode) != null ? res.exitCode : "?") + "). Check the terminal output for details."));
    app.appendChild(d);
  }

  function submit(btn, errNode) {
    if (!isReady()) { errNode.textContent = "Enter a project name and pick a project type first."; return; }
    btn.disabled = true; errNode.textContent = "Working… scaffolding + installing skills (this can take a moment).";
    fetch("/submit?t=" + encodeURIComponent(TOKEN), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: TOKEN, answers: collectAnswers() })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) showDone(true, j.result);
      else if (j && j.result) showDone(false, j.result);
      else { errNode.textContent = "Submit failed: " + ((j && j.error) || "unknown error"); btn.disabled = false; }
    }).catch(function (e) { errNode.textContent = "Network error: " + e; btn.disabled = false; });
  }

  // ---- initial render ----
  function render() {
    var app = document.getElementById("app");

    var band1 = el("div", "section-band");
    band1.appendChild(el("span", "num", "1"));
    band1.appendChild(el("h2", null, "Project"));
    band1.appendChild(el("span", "sub", "Scaffolder, architecture, and version"));
    app.appendChild(band1);

    (PROJECT.steps || []).forEach(function (step) {
      var node = renderProjectStep(step);
      app.appendChild(node);
      if (step.id === "architecture") {
        // Tag the arch card body so client-side preset rebuilds can target it.
        var body = node.querySelector(".card-body"); if (body) body.id = "arch-body";
      }
      if (step.id === "repo-type") {
        // D36: host for the per-type "Upstream scaffolder options" card /
        // requiresTerminal warning, rebuilt on a primary-type change.
        var uo = el("div"); uo.id = "upstream-options"; app.appendChild(uo);
      }
    });
    rebuildUpstreamOptions();

    var band2 = el("div", "section-band");
    band2.appendChild(el("span", "num", "2"));
    band2.appendChild(el("h2", null, "Skills"));
    band2.appendChild(el("span", "sub", "Agent tools + skill packs (from inject-nockta-skills)"));
    app.appendChild(band2);

    skillsEl = el("div"); skillsEl.id = "skills-section"; app.appendChild(skillsEl);
    renderSkillsSection();

    updateAlsoDisabling();
    toggleCustomVersion();

    var bar = el("div", "bar"); var inner = el("div", "inner");
    var left = el("div");
    left.appendChild(el("div", "hint", "")); left.querySelector(".hint").id = "confirm-hint";
    var errNode = el("div", "err"); errNode.id = "confirm-err"; left.appendChild(errNode);
    var btn = el("button", "confirm", "Create project"); btn.type = "button"; btn.id = "confirm-btn";
    btn.addEventListener("click", function () { submit(btn, errNode); });
    inner.appendChild(left); inner.appendChild(btn); bar.appendChild(inner);
    document.body.appendChild(bar);

    updateConfirmEnabled();
    // If a primary type was pre-seeded and we have no first-paint skills yet, kick a fetch.
    if (firstChecked("repo-type") && !(SKILLS.steps || []).some(function (s) { return s.id === "skills"; })) scheduleRederive();
  }

  render();
})();
</script>
</body>
</html>`;
}
