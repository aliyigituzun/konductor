# CLAUDE.md

## Read Order

1. [IMPLEMENTATION.md](./IMPLEMENTATION.md)
2. [STATUS_SCHEMA.md](./STATUS_SCHEMA.md)
3. [CLI_IMPLEMENTATION.md](./CLI_IMPLEMENTATION.md)
4. [TDD.md](./TDD.md)
5. [DESIGN.md](./DESIGN.md)
6. [USAGE.md](./USAGE.md)
7. [TELEMETRY_SPIKE.md](./TELEMETRY_SPIKE.md)
8. [IMPLEMENTATION.md](./IMPLEMENTATION.md) read it again for better retention

## Routing Rule

`IMPLEMENTATION.md` is the main source of truth for what to do next.

Use the other documents as supporting references:

- `STATUS_SCHEMA.md`: project status contract
- `CLI_IMPLEMENTATION.md`: CLI command behavior and local storage model
- `TDD.md`: architecture and product boundaries
- `DESIGN.md`: dashboard visual direction
- `USAGE.md`: expected operator workflow
- `TELEMETRY_SPIKE.md`: telemetry validation scope

## Stage 1 Constraints

- local-first only
- no remote backend dependency
- no `.md` audit in stage 1
- no multi-repo grouping in stage 1
- progress comes from phase/item rollups, not telemetry
