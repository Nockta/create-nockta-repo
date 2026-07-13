# Nockta architecture notes — Shopify App

`shopify app init` owns this project's structure (extensions, web/, app
bridge config, Prisma/session storage, Admin API webhooks). The Nockta
`standard` overlay for `shopify-app` is deliberately minimal — it does not
create any source directories, does not create any convention folders
inside the app itself, and never moves generated files. Fighting the
scaffolder's own layout here would break `shopify app` tooling that expects
its generated structure to stay exactly as generated.

This overlay only adds this `docs/nockta/` folder for Nockta-specific
project notes that don't belong inside the scaffolder-owned tree — team
conventions, extension ownership notes, deployment checklists, etc.

Add your own notes below.
