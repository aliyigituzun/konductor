# Konductor Open Questions

These are the practical unknowns that remain after the local Claude host implementation.

| Priority | Question | Why It Matters | Current Working Assumption |
| --- | --- | --- | --- |
| High | How reliably does Claude Code pick up `.mcp.json` across different local setups? | Dashboard-launched runs depend on MCP discovery to write status and updates automatically. | Keep `.mcp.json` project-scoped and preserve manual `konductor mcp serve` as the fallback. |
| High | How much OTEL signal can we reliably attribute to a single run when multiple Claude sessions overlap? | Per-run telemetry attribution is useful, but current OTEL aggregation remains coarse. | Tag runs where possible, but treat telemetry as project-level best-effort until verified in heavier usage. |
| Medium | Should the dashboard eventually be able to start or restart the host daemon itself? | Right now dashboard control assumes the daemon is already running. | Keep host lifecycle in the CLI for now. |
| Medium | Should prompt packs stay inline in `konductor.config.json`, or move to referenced files by default? | Larger prompt packs make config harder to read and may grow over time. | Keep prompt packs inline by default and allow optional file references. |
| Low | Do we want stop/retry semantics for past runs in the dashboard, or is re-launch enough? | This changes how much orchestration state needs to be modeled. | Re-launch is enough for now; explicit retry workflows can wait. |

## Resolved

- Claude Code is the only supported runner in this implementation.
- The host is local-only.
- The dashboard terminal is read-only.
- Feature launches are single-item only.
- Prompt packs are first-class Konductor config, not just labels.
- Project path inspection is part of the dashboard.
