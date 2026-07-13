# Module template

This directory is a template for a feature module — copy it to
`src/modules/<module-name>/` when you start a new module and give it the
usual Nest trio (`<module-name>.module.ts`, `.controller.ts`, `.service.ts`).

Conventions:

- Cross-cutting concerns (auth guards, exception filters, logging
  interceptors, validation pipes, shared decorators) live in `src/common/`,
  not duplicated inside individual modules.
- One feature = one module under `src/modules/`, registered in the root
  `AppModule`.
- Cross-module types live in `src/types/`; module-local DTOs/entities can
  live alongside the module's own code.

This README and the `_template/` folder itself are placeholders from the
Nockta `standard` architecture overlay — safe to delete once you've created
your first real module.
