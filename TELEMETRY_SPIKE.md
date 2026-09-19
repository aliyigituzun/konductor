# Konductor Telemetry Validation

## Purpose

Verify which telemetry signals are available for each supported agent adapter and
which remain best-effort. The dashboard must not present inferred signals as facts.

## What We Need To Verify

### 1. Token Usage

Verify that an adapter's telemetry output exposes:

- input tokens
- output tokens
- cache read tokens
- cache write tokens

Expected outcome:

- token usage is marked verified only when the adapter supplies it reliably

### 2. Tool Activity

Verify that OTEL events expose:

- tool name
- tool invocation count
- tool parameters when available

Expected outcome:

- Konductor can show top tools used in a session

### 3. File Activity

Verify whether `Read`, `View`, `Edit`, or similar tool events include file paths in tool parameters.

Expected outcome:

- if yes: Konductor can show top files accessed
- if partial: Konductor shows best-effort file activity
- if no: file activity is deferred or replaced by tool-only reporting

### 4. Context Usage

Verify whether adapter telemetry or adjacent runtime state exposes:

- context window size
- current context usage
- peak context usage

Expected outcome:

- if available, context pressure is included in the dashboard
- if not, this moves to later phases

### 5. Compact Count

Verify whether there is any reliable way to count compaction events.

Expected outcome:

- if there is no explicit signal, do not fake this metric

## Test Procedure

1. Run one supported adapter in a sample project with telemetry export enabled.
2. Execute a short session that:
   - reads docs
   - reads code files
   - edits a file
   - makes multiple API requests
3. Capture OTEL metrics and events.
4. Inspect emitted fields and normalize them into a candidate Konductor snapshot.
5. Mark each target signal as:
   - `verified`
   - `best_effort`
   - `unavailable`

## Success Criteria

- token usage is verified
- tool usage is verified
- file activity is at least classified as verified or best-effort
- context usage is either verified or explicitly deferred
- compact count is either verified or explicitly deferred

## Product Rule

Konductor should only advertise telemetry signals that pass this validation. Everything else should be shown as unavailable or best-effort.

## Adapter References

Record the adapter version, telemetry configuration, and source documentation with
each validation result. Do not generalize one adapter's signals to another.
