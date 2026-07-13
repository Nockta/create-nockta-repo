# Nockta architecture notes — Expo

The `create-expo-app` scaffolder owns this project's structure. Per the
current SDK 57 default template, expo-router's file-based routes live at
**`src/app/`** (not a bare top-level `app/` — older tutorials show the
pre-SDK-57 shape), with shared UI in `src/components/`, hooks in
`src/hooks/`, and constants in `src/constants/`, all reachable via the
template's `@/*` -> `src/*` tsconfig path alias. The Nockta `standard`
overlay for `expo` is deliberately minimal and disturbs nothing generated
by the scaffolder; it does **not** create an `app/` directory of its own.

This overlay only adds this `docs/nockta/` folder for Nockta-specific
project notes that don't belong inside the scaffolder-owned tree —
environment/config conventions, EAS build profile notes (once `eas.json`
exists — `create-expo-app` does not generate one), native-module gotchas,
release checklists, etc.

Add your own notes below.
