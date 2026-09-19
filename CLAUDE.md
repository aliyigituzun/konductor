# CLAUDE.md

## Documentation

Read [IMPLEMENTATION.md](./IMPLEMENTATION.md) first. It is the single source of
truth for the product, architecture, implemented capabilities, and next work.

Open another document only when its narrower detail is needed:

- [CLI_IMPLEMENTATION.md](./CLI_IMPLEMENTATION.md) for command behavior
- [DESIGN.md](./DESIGN.md) for dashboard behavior and visual rules
- [STORAGE.md](./STORAGE.md) for SQLite ownership, migration, and backup details
- [USAGE.md](./USAGE.md) for the operator workflow
- [TELEMETRY_SPIKE.md](./TELEMETRY_SPIKE.md) for telemetry validation

The schemas in `packages/schema` are authoritative contracts. Do not maintain
hand-written schema copies in project documentation.

## Product Principles

- Progress comes from phase/item rollups, not telemetry.
- Source schemas and documented storage boundaries take precedence over duplicated
  prose contracts.
- Keep orchestration state explicit and inspectable across agent adapters.
- Dashboard copy is for operators. Developer-side explanations (implementation
  notes, ordering rules, rationale) belong in code comments or docs, never in the
  frontend.
