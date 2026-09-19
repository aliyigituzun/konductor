# Konductor Open Questions

These are the practical unknowns that remain in Konductor's current delivery model.

| Priority | Question | Why It Matters | Current Working Assumption |
| --- | --- | --- | --- |
| High | How consistently do adapters load their MCP configuration? | Agent runs depend on MCP discovery to write status and updates automatically. | Keep adapter configuration explicit and preserve manual `konductor mcp serve` as the fallback. |
| High | How much telemetry can be attributed to one run when several agents overlap? | Per-run telemetry is useful, but aggregation remains coarse. | Tag runs where possible and treat telemetry as best-effort until verified in heavier usage. |
| Medium | Which host operations belong in the dashboard versus the CLI? | Service lifecycle and recovery need clear ownership. | Keep lifecycle controls explicit while the host contract evolves. |
| Medium | Should prompt packs stay inline in `konductor.config.json`, or move to referenced files by default? | Larger prompt packs make config harder to read and may grow over time. | Keep prompt packs inline by default and allow optional file references. |
| Low | Do we want stop/retry semantics for past runs in the dashboard, or is re-launch enough? | This changes how much orchestration state needs to be modeled. | Re-launch is enough for now; explicit retry workflows can wait. |

## Resolved

- Agent adapters are the supported runner boundary.
- The dashboard terminal is a read-and-send mirror, not a complete terminal emulator.
- Feature launches are single-item only.
- Prompt packs are first-class Konductor config, not just labels.
- Project path inspection is part of the dashboard.
