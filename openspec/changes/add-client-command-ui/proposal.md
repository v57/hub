# Add Client Terminal UI

## Why

`src/client/pages` now contains page scaffold files with detailed comments, but no page UI. The `hub client` path must become a real terminal client built on the local terminal UI library, with Hub API actions exposed through a typed control layer.

## What Changes

- Add a `hub client` command path so `bun . client` starts the terminal UI at `src/client/pages/home.ts`.
- Implement every page in `src/client/pages` using `src/client/terminal` components while preserving existing page comments.
- Add or complete all missing Hub action/stream controls under `src/hub`; pages must call controls, not raw Hub paths.
- Add any missing reusable terminal controls to `src/client/terminal` before using page-local workarounds.
- Cover the command, controls, terminal interactions, and page rendering with focused tests and smoke output.

## Impact

- Affected code:
  - `index.ts`
  - `src/launcher/index.ts`
  - `src/client/index.ts`
  - `src/client/pages/**`
  - `src/client/terminal/**`
  - `src/hub/**`
- Validation:
  - `bun test`
  - `bunx tsc --noEmit --pretty false`
  - `bunx openspec validate add-client-command-ui --strict`
  - `bun . client --smoke`
