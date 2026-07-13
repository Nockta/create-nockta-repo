# Feature template

This directory is a template for feature-scoped code — copy it to
`src/features/<feature-name>/` when you start a new feature.

```txt
src/features/<feature-name>/
  components/   feature-scoped UI components (not shared outside this feature)
  hooks/        feature-scoped hooks
```

Conventions:

- Code that's only used by one feature lives inside that feature's folder,
  not in `src/components/`.
- Promote a component to `src/components/ui/` only once a second feature
  needs it.
- Cross-feature types live in `src/types/`; feature-local types can live
  alongside the feature's own code.

Vite React TS has no framework-level routing convention to move files into
(unlike Next's `app/` router), so this overlay does not perform any file
moves — it only adds the folder/doc scaffolding above.

This README and the `_template/` folder itself are placeholders from the
Nockta `standard` architecture overlay — safe to delete once you've created
your first real feature folder.
