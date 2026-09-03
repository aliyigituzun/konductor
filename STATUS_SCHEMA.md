# Konductor Status Schema

## Purpose

Konductor still uses one rolling status snapshot per project, but snapshots can now be tied back to a concrete Claude run.

The current schema version written by Konductor is `0.2.0`.

## Required Top-Level Shape

```json
{
  "schema_version": "0.2.0",
  "project": {
    "id": "konductor",
    "name": "Konductor"
  },
  "agent": {
    "kind": "claude_code",
    "session_id": null
  },
  "report": {
    "reported_at": "2026-05-30T10:15:00Z"
  },
  "status": {
    "state": "in_progress",
    "summary": "Claude host integration is live and dashboard controls are being verified.",
    "current_phase_id": "claude-host"
  },
  "phases": [],
  "issues": {
    "blockers": [],
    "decisions_needed": [],
    "external_dependencies": [],
    "risks": []
  },
  "next_actions": [],
  "features": [],
  "links": {
    "task_url": null,
    "pr_url": null,
    "issue_urls": []
  },
  "run": {
    "run_id": "run-123",
    "profile_id": "claude-default",
    "feature_item_id": "feature-search-debug",
    "source": "dashboard"
  }
}
```

## Notes On New Run Metadata

### `run`

Optional, but now used whenever status was written from a host-managed Claude run.

Fields:

- `run_id`
- `profile_id`
- `feature_item_id` nullable
- `source` = `dashboard` or `cli`

This object is stamped by `konductor mcp serve` when Claude writes status through MCP with run env vars present.

### `updates.jsonl`

Update entries now also support:

- `run_id`
- `profile_id`
- `feature_item_id`
- `source`
- `task_state`

That makes the dashboard update feed and run history traceable.

## Config Shape Summary

`konductor.config.json` now includes:

```json
{
  "schema_version": "0.2.0",
  "project_id": "konductor",
  "project_name": "Konductor",
  "repo_root": ".",
  "default_branch": "main",
  "agent": {
    "primary": "claude_code"
  },
  "agents": {
    "default_profile": "claude-default",
    "profiles": [
      {
        "id": "claude-default",
        "title": "Claude Code",
        "runner": "claude_code",
        "binary": "claude",
        "args": [],
        "default_mcp": true,
        "default_working_dir": "project_root",
        "default_env": {},
        "telemetry": {
          "provider": "opentelemetry",
          "mode": "collector"
        }
      }
    ],
    "prompt_packs": [
      {
        "id": "konductor-default",
        "title": "Konductor Default",
        "instructions": "Work as the active coding agent for this project.",
        "file_refs": [],
        "mcp_reminder": "Use Konductor MCP when available."
      }
    ]
  },
  "host": {
    "port": 4096,
    "log_retention": 50,
    "auto_start": false
  }
}
```

## Validation Rules

- arrays should always be present, even when empty
- `features` is optional, but preferred when dashboard feature launching is used
- `run` is optional
- unknown keys are still discouraged

## MCP Behavior

The Konductor MCP server now exposes:

- `get_status_schema`
- `get_current_status`
- `get_project_context`
- `get_run_context`
- `write_update`
- `write_status`

When `KONDUCTOR_RUN_ID` and related env vars are present, `write_update` and `write_status` automatically attach the active run metadata.
