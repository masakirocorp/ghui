# Launch-scoped organization filtering

## Why

Gardn launches ghui with a known GitHub organization and must keep HOME queues and the repository catalog focused on that organization without changing explicit repository workflows or saved preferences.

## What we'd ship

- Parse `--org <login>` and `GHUI_ORG` with strict validation and CLI-over-environment precedence.
- Add `org:<login>` to HOME pull-request and issue searches and keep scoped queue cache keys separate.
- Filter HOME repositories and cached rollups, and fall back to scoped HOME when cwd belongs to another owner.
- Display the active organization in the header.
- Support `GHUI_SHOW_SCROLLBARS=true` as a launch-only override.

## API / architecture mapping

- `src/launchOptions.ts` owns launch parsing, validation, and repository membership.
- `src/config.ts` exposes parsed launch options to the typed runtime configuration.
- `src/item.ts`, `CacheService`, and repository derivations apply the active scope.
- `src/themeStore.ts` gives the scrollbar override precedence without persisting it.

## Open questions

- None for the initial implementation.

## Out of scope (for v1)

- Persisting an organization selection.
- Restricting explicit repository views or repository-scoped actions.
- Modifying Gardn itself.

## Status

In progress
