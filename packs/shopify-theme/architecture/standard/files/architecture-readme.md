# Nockta architecture notes — Shopify Theme

`shopify theme init` owns this project's structure (`sections/`,
`snippets/`, `templates/`, `layout/`, `assets/`, `locales/`, `config/`).
Shopify's theme file layout is a fixed, tooling-recognized contract — the
Nockta `standard` overlay for `shopify-theme` does not create, move, or
rename anything inside it. Doing so would fight both `shopify theme` CLI
tooling and Shopify's own theme editor.

This overlay only adds this `docs/nockta/` folder for Nockta-specific
project notes that don't belong inside the theme's own tree — section
ownership notes, naming conventions for custom sections/snippets,
deployment checklists, etc.

Add your own notes below.
